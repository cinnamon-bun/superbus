
//================================================================================ 
// LOGGING

//let log = console.log;
const log = (...args: any[]) => {};
const busdebug =     '        🚌';

//================================================================================ 
// CONFIG

const DEFAULT_CB_MODE = 'blocking';
const DEFAULT_SEP = ':'

//================================================================================ 
// TYPES

type Thunk = () => void;
export type SuperbusCallback<Ch> = (channel: Ch, data?: any) => void | Promise<void>;

export interface SuperbusOpts {
    mode: 'blocking' | 'nonblocking',  // default: blocking
}
interface CallbackAndOpts<Ch> extends SuperbusOpts {
    callback: SuperbusCallback<Ch>,
}

//================================================================================ 

// Blocking only happens when both sender and listener want it.
//
// Examples: 
//
// Both sender and listener want blocking.
// The listeners will be launched synchronously with sendAndWait,
// and sendAndWait will block until all the blocking listeners are done running.
// 
//     // blocking listener and blocking sender
//     on('hello', () => {}, { mode: 'blocking' });
//     on('hello', async () => {}, { mode: 'blocking' });
//     await sendAndWait('hello');
// 
// For any other combination, it will run in nonblocking mode.  The
// listeners will be launched on nextTick and sendLater will immediately
// continue.
// 
//     // blocking listener but nonblocking sender
//     on('hello', () => {}, { mode: 'blocking' });
//     on('hello', async () => {}, { mode: 'blocking' });
//     sendLater('hello');
// 
//     // nonblocking listener and nonblocking sender
//     on('hello', () => {}, { mode: 'nonblocking' });
//     on('hello', async () => {}, { mode: 'nonblocking' });
//     sendLater('hello');
// 
//     // nonblocking listener but blocking sender
//     on('hello', () => {}, { mode: 'nonblocking' });
//     on('hello', async () => {}, { mode: 'nonblocking' });
//     await sendAndWait('hello');

export class Superbus<Ch extends string> {
    // For each channel, we have a Set of callbacks.
    _subs: Record<string, Set<CallbackAndOpts<Ch>>> = {};
    // Character used to separate channel name from id, like 'changed:123'
    _sep: string;

    constructor(sep: string = DEFAULT_SEP) {
        this._sep = sep;
    }

    on(channelInput: Ch | Ch[], callback: SuperbusCallback<Ch>, opts: Partial<SuperbusOpts> = {}): Thunk {
        // Add a listener to one or multiple channels.
        //
        // Multiple channels in an array are meant to be used for
        // unrelated events like on(['open', 'close'], () => {})
        // Don't use subscribe to related channels like ['changed:123', 'changed']
        // -- that will be handled for you; a send to 'changed:123' will also
        // trigger 'changed' listeners.
        //
        // In opts, you can specify if you want your callback to be called in blocking
        // or nonblocking mode.
        //  on('close', () => {}, { mode: 'blocking' });
        //  on('close', () => {}, { mode: 'nonblocking' });
        //
        // Blocking mode will only block if the sender also wants to be blockable.
        // Blocking mode works with sync or async callbacks.
        // Nonblocking mode will always be nonblocking no matter how
        // the sender sends the message.
        //
        opts.mode = opts.mode ?? DEFAULT_CB_MODE;
        const callbackAndOpts: CallbackAndOpts<Ch> = {
            ...opts as SuperbusOpts,
            callback: callback,
        }
        log(`${busdebug} on`, channelInput, JSON.stringify(opts));

        const channels: Ch[] = (typeof channelInput === 'string') ? [channelInput] : channelInput;
        for (const channel of channels) {
            log(`${busdebug} ...on`, channel);
            // Subscribe to a channel.
            // The callback can be a sync or async function.
            const set = (this._subs[channel] ??= new Set());
            set.add(callbackAndOpts);
        }
        // Return an unsubscribe function.
        return () => {
            log(`${busdebug} unsubscribe from ${channels}`);
            for (const channel of channels) {
                const set = this._subs[channel];
                if (set !== undefined) {
                    set.delete(callbackAndOpts);
                    // Prune away channels with no subscribers.
                    if (set.size === 0) {
                        delete this._subs[channel];
                    }
                }
            }
        }
    }
    _expandChannelToListeners(channel: Ch): (Ch | '*')[] {
        // When a message is sent to a channel,
        // we also send it to the related but less specific listeners,
        // in order from most to least specific.
        // 
        //  send to          listeners who get it
        // ----------        ----------------------
        // 'changed'     --> ['changed', '*']
        // 'changed:123' --> ['changed:123', 'changed', '*']
        //
        const channels: (Ch | '*')[] = [channel];
        if (channel.indexOf(this._sep) !== -1) {
            const [baseChannel] = channel.split(this._sep, 1);
            channels.push(baseChannel as Ch);
        }
        channels.push('*');
        log(`${busdebug} _expandChannels "${channel}" -> ${JSON.stringify(channels)}`);
        return channels;
    }
    async sendAndWait(channel: Ch, data?: any): Promise<void> {
        // Send a message and wait for all blocking listeners to finish running.
        // Blocking listeners will be launched inline during this function.
        // If they return a promise, we wait for all the promises to resolve
        // or reject before returning from this function.
        // (Those async listener callbacks run in parallel, not series).

        // Nonblocking listeners will be launched on nextTick because
        // we only block if BOTH sender and listener want to.

        // A channel gets expanded in order from most to least specific listeners: [changed:12345, changed, *]
        // The callbacks are called in the same order, most specific to least.
        // The channel given to the callback is always the original, most specific version of the channel.
        // For example, the '*' listener callback would get 'changed:12345' as the channel.
         
        // If a listener has an id, it will only be called when that id is present, not for generic events without ids.
        // Generic listeners with no id will be called for all events of that kind with or without ids.
        // In other words, generic listeners are act sort of like "changed:*"

        // '*' listeners are called for messages on every channel.

        // send this   --> to these listeners:

        // message sent: | listeners get...
        // --------------|-------------------------------------
        //               | changed:123   changed       *
        // --------------|------------------------------------
        // changed:123   | changed:123   changed:123   changed:123
        // changed:444   |               changed:444   changed:444
        // changed       |               changed       changed
        // banana        |                             banana

        const subChannels = this._expandChannelToListeners(channel);
        // send to expanded channels in most-specific to least-specific order
        for (const subChannel of subChannels) {
            log(`${busdebug} sendAndWait(send ${channel} to ${subChannel} subscription, ${data})`);
            const cbsAndOpts = this._subs[subChannel];
            if (cbsAndOpts === undefined || cbsAndOpts.size === 0) { continue; }
            // keep a list of promises from our blocking async callbacks
            const proms : Promise<any>[] = [];
            for (const cbAndOpt of cbsAndOpts) {
                const { mode, callback } = cbAndOpt;
                if (mode === 'blocking') {
                    // launch blocking listeners right here
                    try {
                        const prom = callback(channel, data);
                        if (prom instanceof Promise) {
                            proms.push(prom);
                        }
                    } catch (e) {
                        log(`${busdebug} error while launching blocking callback`);
                        console.error(e);
                    }
                } else if (mode === 'nonblocking') {
                    // launch nonblocking listeners later
                    queueMicrotask(() => callback(channel, data));
                }
            }
            // wait for all the promises to finish
            //await Promise.allSettled(proms);
            for (const prom of proms) {
                try {
                    await prom;
                } catch (e) {
                    log(`${busdebug} error while awaiting promise`);
                    console.error(e);
                }
            }
        }
    }
    sendLater(channel: Ch, data?: any): void {
        // Defer sending the message to the next tick.
        // Launch all the callbacks then, and don't wait for any of them to finish.
        // This function will immediately return before any callback code runs.
        //
        // All other details are the same as sendAndWait.
        const subChannels = this._expandChannelToListeners(channel);
        for (const subChannel of subChannels) {
            log(`${busdebug} sendAndWait(send ${channel} to ${subChannel} subscription, ${data})`);
            const cbsAndOpts = this._subs[subChannel];
            if (cbsAndOpts === undefined || cbsAndOpts.size === 0) { continue; }
            for (const cbAndOpt of cbsAndOpts) {
                const { callback } = cbAndOpt;
                queueMicrotask(() => callback(channel, data));
            }
        }
    }
    removeAllSubscriptions(): void {
        log(`${busdebug} removeAllSubscriptions()`);
        for (const set of Object.values(this._subs)) {
            set.clear();
        }
        this._subs = {};
    }
}

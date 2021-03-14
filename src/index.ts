
//================================================================================ 
// LOGGING

//let log = console.log;
let log = (...args: any[]) => {};
let busdebug =     '        🚌';

//================================================================================ 

type Thunk = () => void;
type Callback<Ch> = (channel: Ch, data?: any) => void | Promise<void>;

export class Superbus<Ch extends string> {
    // For each channel, we have a Set of callbacks.
    _subs: Record<string, Set<Callback<Ch>>> = {};
    // Character used to separate channel name from id, like 'changed:123'
    _sep: string;

    constructor(sep: string = ':') {
        this._sep = sep || ':'
    }

    on(channelInput: Ch | Ch[], callback: Callback<Ch>): Thunk {
        log(`${busdebug} on`, channelInput);
        let channels: Ch[] = (typeof channelInput === 'string') ? [channelInput] : channelInput;
        for (let channel of channels) {
            log(`${busdebug} ...on`, channel);
            // Subscribe to a channel.
            // The callback can be a sync or async function.
            let set = (this._subs[channel] ??= new Set());
            set.add(callback);
        }
        // Return an unsubscribe function.
        return () => {
            log(`${busdebug} unsubscribe from ${channels}`);
            for (let channel of channels) {
                let set = this._subs[channel];
                if (set !== undefined) {
                    set.delete(callback);
                    // Prune away channels with no subscribers.
                    if (set.size === 0) {
                        delete this._subs[channel];
                    }
                }
            }
        }
    }
    _expandChannelsToListeners(channel: Ch): (Ch | '*')[] {
        // changed:123 --> [changed:123, changed, *]

        let channels: (Ch | '*')[] = [channel];
        if (channel.indexOf(this._sep) !== -1) {
            let [baseChannel] = channel.split(this._sep, 1);
            channels.push(baseChannel as Ch);
        }
        channels.push('*');
        log(`${busdebug} _expandChannels "${channel}" -> ${JSON.stringify(channels)}`);
        return channels;
    }
    async sendAndWait(channel: Ch, data?: any): Promise<void> {
        // Send a message and wait for all subscribers to finish running.
        // Synchronous subscribers will block anyway.
        // For async subscribers, we await their promise.
        // The async subscribers will all run in parallel.

        // A channel gets expanded in order from most to least specific listeners: changed:12345, changed, *.
        // The callbacks are called in the same order, most specific to least.
        // The channel given to the callback is always the original, most specific version of the channel.
         
        // If a listener has an id, it will only be called when that id is present, not for generic events without ids.
        // Generic listeners with no id will be called for all events with or without ids.
        // In other words, generic listeners are act sort of like "changed:*"

        // send this   --> to these listeners:

        //               | listeners get...
        // --------------|-------------------------------------
        // message sent: | changed:123   changed       *
        // --------------|------------------------------------
        // changed:123   | changed:123   changed:123   changed:123
        // changed:444   |               changed:444   changed:444
        // changed       |               changed       changed
        // banana        |                             banana

        let listeners = this._expandChannelsToListeners(channel);
        for (let listener of listeners) {
            log(`${busdebug} sendAndWait(send ${channel} to ${listener} subscription, ${data})`);
            let cbs = this._subs[listener];
            if (cbs === undefined || cbs.size === 0) { continue; }
            let proms: Promise<any>[] = [];
            for (let cb of cbs) {
                // this might be a promise, or something else if the callback was synchronous
                try {
                    let prom = cb(channel, data);
                    if (prom instanceof Promise) {
                        proms.push(prom as any);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
            await Promise.all(proms).finally();
            //await Promise.allSettled(proms);
        }
    }
    sendLater(channel: Ch, data?: any) {
        // Defer sending the message to the next tick.
        // Launch all the callbacks then, and don't wait for any of them to finish.
        // This function will immediately return before any callback code runs.
        //
        // Star listeners, and messages with ids, are handled the same way as sendAndWait.
        let listeners = this._expandChannelsToListeners(channel);
        for (let listener of listeners) {
            log(`${busdebug} sendAndWait(send ${channel} to ${listener} subscription, ${data})`);
            let cbs = this._subs[listener];
            if (cbs === undefined || cbs.size === 0) { continue; }
            process.nextTick(() => {
                for (let cb of cbs) {
                    cb(channel, data);
                }
            });
        }
    }
    removeAllSubscriptions() {
        // Remove all subscriptions
        log(`${busdebug} removeAllSubscriptions()`);
        for (let set of Object.values(this._subs)) {
            set.clear();
        }
        this._subs = {};
    }
}

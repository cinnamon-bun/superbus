# Superbus and Simplebus

A couple of message busses that are all about running things in series, not in parallel.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Motivation](#motivation)
- [Simplebus](#simplebus)
  - [Example](#example)
  - [API](#api)
  - [The Lock, and how to avoid deadlock](#the-lock-and-how-to-avoid-deadlock)
  - [Error handling](#error-handling)
  - [Callback execution order](#callback-execution-order)
- [Superbus](#superbus)
    - [Vocabulary](#vocabulary)
    - [Feature: channel specificity](#feature-channel-specificity)
    - [Feature: blocking and backpressure](#feature-blocking-and-backpressure)
  - [Install it](#install-it)
  - [Subscribe to a channel](#subscribe-to-a-channel)
  - [Subscribe to run a callback only once](#subscribe-to-run-a-callback-only-once)
    - [Sending: special async behavior](#sending-special-async-behavior)
    - [Sending nonblockingly](#sending-nonblockingly)
    - [Blocking until listeners finish running](#blocking-until-listeners-finish-running)
  - [Message specificity, `'*'` listeners, and special handling of messages with ids](#message-specificity--listeners-and-special-handling-of-messages-with-ids)
    - [Examples](#examples)
    - [Constructing a channel name with an id -- only one layer deep](#constructing-a-channel-name-with-an-id----only-one-layer-deep)
  - [Typescript: using stricter generic types](#typescript-using-stricter-generic-types)
  - [Error handling](#error-handling-1)
    - [TL;DR about errors](#tldr-about-errors)
    - [Errors from listeners we're blocking on](#errors-from-listeners-were-blocking-on)
    - [Errors from listeners we're running later](#errors-from-listeners-were-running-later)
  - [FAQ](#faq)
    - [Can I send a message from inside a listener callback?](#can-i-send-a-message-from-inside-a-listener-callback)
    - [There should be a generic type parameter for the data payload too.](#there-should-be-a-generic-type-parameter-for-the-data-payload-too)
    - [Can we specify more strict specific data payload types for each different channel name?](#can-we-specify-more-strict-specific-data-payload-types-for-each-different-channel-name)
    - [What order are callbacks called in?](#what-order-are-callbacks-called-in)
    - [When exactly do callbacks run?](#when-exactly-do-callbacks-run)
    - [Can callback invocations be coalesced or debounced?](#can-callback-invocations-be-coalesced-or-debounced)
    - [Does Superbus ensure that messages are really handled one at a time?](#does-superbus-ensure-that-messages-are-really-handled-one-at-a-time)
      - [When it won't work](#when-it-wont-work)
  - [Does overlapping prevention work across different channels?](#does-overlapping-prevention-work-across-different-channels)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Motivation

Async code can be tricky because you never know what functions are running at the same time, stepping on each others' toes.

These message busses help by offering careful control over when callback functions are allowed to overlap and when they are forced to run one at a time, in series.

When you know your functions will never overlap, you can avoid a whole class of race conditions and other tricky bugs.

# Simplebus

A simple message bus that doesn't even have multiple channels.  It's a single thing you can subscribe to, and all subscribers will get all messages.

It enforces this rule: only one callback handler can be running at a time.  Two callback handlers will never overlap, even if they are slow async functions.

## Example

```ts
let bus = new Simplebus<string>();

// subscribe with a sync or async function
let unsub = bus.on((data: string) => {
    console.log('got an event:', data);
});

// send an event and wait for all the callbacks to finish
await bus.send('hello world')

// remove the subscription
unsub();
```

## API

```ts
let bus = new Simplebus<'open' | 'close'>();
```

Create a new Simplebus.  The type parameter controls what kind of event data can be passed through it.

```ts
async send(data: T, opts?: { useLock: boolean })
```

Send an event.  All the callbacks will be run **one at a time** in an undefined order.  Callbacks can never run in an interleaved, parallel way, even if they're slow async functions.

If you `await send`, you'll block until all the callbacks are finished running.  It's ok to leave off the `await` if you don't want to block right then.  Even without `await`, only one callback will be run at a time.

```ts
on(cb: SimplebusCallback<T>): () => void
once(cb: SimplebusCallback<T>): () => void

type SimplebusCallback<T> = (data: T) => void | Promise<void>;
```

Subscribe to events.  These can accept synchronous or async callbacks.  They return an unsubscribe function.

The `once` callbacks will be removed after firing once.  You can also unsubscribe them before (or after) that happens.

```ts
removeAllSubscribers(): void
```

Clear out the bus by removing all callbacks.

## The Lock, and how to avoid deadlock

Simplebus has an internal lock that makes sure that only one event is being handled at a time.  For example, if you forget the `await` and just do this:

```ts
// no await, but they still run one at a time without overlapping
bus.send('open');
bus.send('close');
```

Simplebus will internally make sure that the `open` event is totally processed, and all its callbacks are done running, before it sends the `close` event.  (These `send` calls won't block since there's no `await` -- Simplebus is queueing up the events internally.)

The lock means **it's not safe to `send` from inside a subscriber callback**.  Since the lock is already locked by the first send that's in progress, the inner send will wait forever for it.

```ts
// DON'T SEND FROM INSIDE A CALLBACK
bus.on(async (data: Data) => {
    if (data === 'close') {
        // THIS WILL GET STUCK FOREVER
        await bus.send('closeSomethingElse');
    }
});
```

This only matters if it's the same Simplebus instance you're sending to.

There's a hidden option to disable the lock:

```ts
send(data, { useLock: false })
```

```ts
// THIS WORKS
bus.on(async (data: Data) => {
    if (data === 'close') {
        // ...because we skip the lock here
        await bus.send('closeSomethingElse', { useLock: false });
    }
});
```

## Error handling

Remember that callbacks run one at a time.  If any callback throws an error, that error will emerge from the `await bus.send()` call, and it will stop processing of the event, so some of the callbacks won't get a chance to run.

## Callback execution order

Callbacks are run in the order they were added, except that all of the `on` callbacks go first, and then all of the `once` callbacks.

If several events were sent at around the same time: All the callbacks are run for the first event (one at a time), then all the callbacks run for the next event, etc.  Events are processed in the order they were sent.

# Superbus

A message bus with a few tricks up its sleeve.

You can send **messages** to **channels**, and each message can have a data payload.  You can subscribe to a channel with a listener callback.

### Vocabulary 

* listen, subscribe -- same meaning -- hook up a callback to run when an event is sent.
* listener, subscriber -- same meaning -- the callback that was registered

### Feature: channel specificity

Channel names can have different levels of specificity, and subscribers are triggered by their channel and anything more specific.

Example: sending to `deleted:abc` will trigger listeners for:
* `deleted:abc`
* `deleted`
* `*`

...in that order.

> Why this channel name thing?
>
> This is useful when you have React components observing items in a collection.  You might want the parent component to react to `added` and `deleted`, but the child components to react to certain items by their id: `changed:abcde`
>
> You can also listen to `"*"` to get all events.

### Feature: blocking and backpressure

Senders and listeners can choose to be in "blocking mode".  If both are in blocking mode, then sending a message will block until all the listeners have finished running, even if they are async callbacks.

If either the sender or the listener are in nonblocking mode, the listener callbacks will run with `setTimeout`.

> Why this blocking thing?
>
> This lets us have backpressure in our message bus.  You can send a message and make sure all the listeners are done processing it before sending another one.  Without this, you could send thousands of messages, with large data payloads, and their listeners would all be launched simultaneously but be queued by the javascript engine to run later.  Instead, it's better to block until each message is fully processed so you only send one at a time.  It uses less memory and reduces the chance of data races.

## Install it

```sh
npm install --save superbus
```

or

```sh
yarn add superbus
```

## Subscribe to a channel

Listeners can subscribe by adding a callback like

```ts
let myBus = new Superbus();

// myBus.on(channel, callback, options?) : unsubscribeFn

myBus.on('something', (channel, data) => {
    // channel is the name of the channel: 'something'
    // data is any payload that came with the message.
}, { mode: 'blocking' });
```

`mode` can be `blocking` or `nonblocking`.  You can omit the options object entirely; the default mode is `blocking`.

You get an unsubscribe function back:

```ts
let unsub = myBus.on('something', () => {});

unsub();
```

You can also subscribe with an `async` callback:

```ts
myBus.on('something', async (channel, data) => {
    await do_something_async_here();
});
```

## Subscribe to run a callback only once

Use `once(...)` instead of `on(...)` and your callback will be removed after the first time it runs.

```ts
let unsub = myBus.once('something', () => {
    console.log('this only happens once');
});
```

You can also pass this as one of the options to `on(...)`:

```ts
let unsub = myBus.on('something', () => {
    console.log('this only happens once');
}, { once: true });
```

### Sending: special async behavior

There are two ways to send a message:

```ts
// blocking
await myBus.sendAndWait('hello', data);

// nonblocking
myBus.sendLater('hello', data);
```

The `data` argument is optional.

### Sending nonblockingly

`sendLater` sends your message with `setTimeout`:

```ts
let foo = () => {
    myBus.sendLater('hello');
    console.log('The listeners have not run yet.');
    console.log('They will run later when setTimeout fires.');
}
```

### Blocking until listeners finish running

`sendAndWait` runs the blocking listener callbacks right away and waits for them all to finish, even the async ones.  Make sure to `await` it.

The listeners that were registered as `nonblocking` will be run nonblockingly with `setTimeout`.  Only when the sender AND the listener want to block, will the blocking behaviour occur.

```ts
let foo = async () => {
    await myBus.sendAndWait('hello');
    console.log('Blocking listeners have all finished running now.');
    console.log('Nonblocking listeners have not run yet,');
    console.log(' and will run with setTimeout.');
}
```

The blocking callbacks that are async are run in parallel and we wait for them to all
to finish or throw errors before returning from `sendAndWait`.

**NOTE!**  Don't forget the `await` on sendAndWait.  If you do, only the synchronous callbacks will finish running before your code continues.  The async callbacks will be started but won't finish until later.

## Message specificity, `'*'` listeners, and special handling of messages with ids

You can send messages with two levels of specificity:

```
// send to...

'changed:abc'  // more specific, includes an id
'changed'      // less specific

// (You can't send to the '*' channel.)
```

The part after the colon is called the "id".  It can be used, for example, to describe which object changed.

And you can listen with three levels of specificity:

```
// listeners      triggered by

'changed:abc'  // 'changed:abc'
'changed'      // 'changed', 'changed:abc', 'changed:xyz', ...
'*'            //  anything
```

Listeners run in the order above, from most specific to least specific.

### Examples

```ts
// listen to all messages
myBus.on('*', () => {});
```

```ts
// send to a channel with an id
myBus.sendLater('changed:abc', myData);
```

Sending the message above will trigger all 3 of these listeners, in order from
most to least specific.  

```ts
myBus.on('changed:abc', () => {});  // only when item "abc' has changed
myBus.on('changed', () => {});      // when anything is changed
myBus.on('*', () => {});            // any message at all
```

Similarly, sending a regular "changed" message with no ID will trigger these listeners:

```ts
myBus.sendLater('changed', myData);  // just 'changed' with no id

myBus.on('changed', () => {});   // any 'changed' or 'changed:...' message
myBus.on('*', () => {});         // any message at all
```

In other words, listeners will hear the channel they signed up for and any
channels that are more specific.

So one sent message will trigger either 3 or 2 channels depending on if it has an id or not.  Of course there may not be listeners on some of those channels, or there may be many callbacks registered on some of those channels.

The arguments of the listener callback are `(channel, data)`.  Channel will be the most specific channel name, not the channel name that was subscribed to.  So, for example, a `'*'` listener can still tell what kinds of messages it's hearing.

### Constructing a channel name with an id -- only one layer deep

Only the first colon is detected:

```
sending "changed:a:b:c"
is considered to be the channel "changed" with id "a:b:c".

it will trigger listeners for: "changed:a:b:c", "changed", and "*"
```

The default separator character is colon `':'` but you can change it in the constructor:

```ts
let myBus = new Superbus('/');
myBus.sendLater('added/abc');
```

## Typescript: using stricter generic types

You can limit the channel names by providing a type to the constructor.  It must be a subtype of `string`.

```ts
// default
new Superbus<string>();

// only allow certain channel names
type MyChannels = 'open' | 'close';
new Superbus<MyChannels>();
```

...but you'll have to give Typescript some extra help when you use ids since they don't match your list of channel names.

```ts
myBus.sendLater('open:123' as 'open'); 
myBus.on('open:123' as 'open', () => {});
```

There is no way to narrow down the type of `data` based on the channel name, yet.

## Error handling

Errors thrown from listeners can happen in two ways, and both are a little awkward.

### TL;DR about errors

Try to catch errors and do something useful about them from inside your listener callback functions, because it's awkward for the error to be thrown out of your listener and into the complex machinery of superbus.  Superbus does its best, but it's weird.

### Errors from listeners we're blocking on

These are functions with `{ mode: 'blocking' }` (the default) AND when an event is sent using `await sendAndWait('hello')`.

These functions might be either sync or async.

Sending an event can run many listener functions.  We don't want one error to stop all the other listeners.

So instead of throwing errors from the listeners, we gather them into an array and return it like so:

`let errors = await sendAndWait('hello');`

`errors` will be `null` if there were no errors, or `Error[]` if there were some errors.  The errors are not thrown; it's up to your code to do that.  How would superbus know which one to throw, since it can only throw one?

### Errors from listeners we're running later

These are functions with `{ mode: 'nonblocking' }` OR when an event is sent using `sentLater('hello')`.

These functions might be either sync or async.

These functions are run using `setTimeout`, so they are executed outside of our regular scope.  We can't get their errors and do anything with them.  They're off on their own now.

Errors thrown by these listener functions will become unhandled exceptions (for sync functions) or unhandled rejections (for async functions).

## FAQ

### Can I send a message from inside a listener callback?

I have not tried this, but I think it's safe.  (TODO: test it.)

In blocking mode, the original outer `sendAndWait` will not complete until the inner, nested `sendAndWait` completes.

### There should be a generic type parameter for the data payload too.

Agreed, PR accepted :)

### Can we specify more strict specific data payload types for each different channel name?

Not currently.  This is very tricky to do, especially because channel names that have ids are made at runtime and not known in advance.

### What order are callbacks called in?

For a specific message, the callbacks are always launched in order from most specific to least specific: all listeners for `changed:123`, then all listeners for `changed`, and then all listeners for `*`.

But note that async callbacks are run in parallel, e.g. we don't wait for one to finish before launching the next one during the sending of a single message.

When multiple listeners have been added to a single channel, they run in the order they were added.

### When exactly do callbacks run?

For `sendLater` they are launched with `setTimeout`, nonblockingly.  This gives the browser event loop time to do other stuff.

For `sendAndWait`, they are launched synchronously and then awaited using `Promise.all(promises).finally()`.  This means that synchronous callbacks will run inline, blockingly, and async callbacks will be awaited in parallel.

If you accidentally call `sendAndWait` without awaiting it (don't do this), the synchronous callbacks should still be run blockingly and will complete before `sendAndWait` exits.  The async callbacks will not be awaited; but I think the parts of those functions before the first `await` will be run blockingly.  TODO: test this more carefully.

### Can callback invocations be coalesced or debounced?

Not by this package, but you can do it yourself using a package like [lodash.debounce](https://www.npmjs.com/package/lodash.debounce) or [debounce](https://www.npmjs.com/package/debounce).

### Does Superbus ensure that messages are really handled one at a time?

Under certain circumstances:

Example:

```ts
let myBus = new Superbus();

// a blocking listener that takes a while to run
myBus.on('hello', async (channel, data) => {
    await sleep(100);
    console.log(`hello ${data} is starting...`);
    await sleep(100);
    console.log(`hello ${data} is done`);
    await sleep(100);
}, { mode: 'blocking' });

// send 10 messages one at a time
for (let ii = 0; ii < 10; ii++) {
    await myBus.send('hello', ii):
}
```

Output:

```
hello 0 is starting...
hello 0 is done.
hello 1 is starting...
hello 1 is done.
hello 2 is starting...
hello 2 is done.
hello 3 is starting...
hello 3 is done.
(etc)
```

Note that each listener finishes before the next one starts.

For this to work, you must
1. send all the messages from a single place,
2. using `await bus.sendAndWait`,
3. and all the listeners must be blocking (`{ mode: 'blocking' }`).

The only thing that keeps the listeners from overlapping is the `await` on `sendAndWait`.  There's no lock or other special mechanism inside Superbus.

#### When it won't work

If you send messages from various places in your code at the same time, the listeners can overlap.  Everything depends on that `await` holding you back until the next `send`...

```ts
// these will both run at the same time,
// overlapping the listeners' execution :(

setTimeout(async () => {
    await myBus.sendAndWait('hello', 1);
}, 100);

setTimeout(async () => {
    await myBus.sendAndWait('hello', 2);
}, 100);
```

Note also that when a channel has multiple listeners, those listeners are run in parallel and will overlap.

## Does overlapping prevention work across different channels?

Yes, as long as you follow the rules above.  Everything depends on that `await` holding you back until the next `send`.

Example:

```ts
// each send will wait until the blocking listeners finish
// before moving on to the next send
await myBus.sendAndWait('apple');
await myBus.sendAndWait('banana');  // ok to have different channels
await myBus.sendAndWait('cherry');
```

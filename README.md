# Superbus

A message bus with a few tricks up its sleeve.

You can send **messages** to **channels**, and each message can have a data payload.  You can subscribe to a channel with a listener callback.

## Feature: channel specificity

Channel names can have different levels of specificity, and subscribers are triggered by their channel and anything more specific.

> Why this channel name thing?
>
> This is useful when you have React components observing items in a collection.  You might want the parent component to react to `added` and `deleted`, but the child components to react to certain items by their id: `changed:abcde`
>
> You can also listen to `"*"` to get all events.

## Feature: blocking and backpressure

Senders and listeners can choose to be in "blocking mode".  If both are in blocking mode, then sending a message will block until all the listeners have finished running, even if they are async callbacks.

If either the sender or the listener are in nonblocking mode, the listener callbacks will run on `nextTick` (or the browser equivalent).

> Why this blocking thing?
>
> This lets us have backpressure in our message bus.  You can send a message and make sure all the listeners are done processing it before sending another one.  Without this, you could send thousands of messages, with large data payloads, and their listeners would all be launched simultaneously but be queued by the javascript engine to run later.  Instead, it's better to block until each message is fully processed so you only send one at a time.  It uses less memory and reduces the chance of data races.

# Install it

```sh
npm install --save superbus
```

or

```sh
yarn add superbus
```

# Subscribe to a channel

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

# Sending: special async behavior

There are two ways to send a message:

```ts
// blocking
await myBus.sendAndWait('hello', data);

// nonblocking
myBus.sendLater('hello', data);
```

The `data` argument is optional.

## Sending nonblockingly

`sendLater` sends your message at `nextTick` or the browser equivalent:

```ts
let foo = () => {
    myBus.sendLater('hello');
    console.log('The listeners have not run yet.');
    console.log('They will run on nextTick.');
}
```

## Blocking until listeners finish running

`sendAndWait` runs the blocking listener callbacks right away and waits for them all to finish, even the async ones.  Make sure to `await` it.

The listeners that were registered as `nonblocking` will be run nonblockingly on `nextTick`.  Only when the sender AND the listener want to block, will the blocking behaviour occur.

```ts
let foo = async () => {
    await myBus.sendAndWait('hello');
    console.log('Blocking listeners have all finished running now.');
    console.log('Nonblocking listeners have not run yet.');
}
```

The blocking callbacks that are async are run in parallel and we wait for them to all
to finish or throw errors before returning from `sendAndWait`.

Don't forget the `await` on sendAndWait.  If you do, only the synchronous callbacks will finish running before your code continues.  The async callbacks will be started but won't finish until later.

# Message specificity, `'*'` listeners, and special handling of messages with ids

You can send messages with two levels of specificity:
```
// send to...

'changed:abc'  // more specific, includes an id
'changed'      // less specific
```

The part after the colon is called the "id".  It can be used, for example, to describe which object changed.

And you can listen with three levels of specificity:
```
// listeners      triggered by

'changed:abc'  // 'changed:abc'
'changed'      // 'changed', 'changed:abc', 'changed:xyz', ...
'*'            //  anything
```

## Examples

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
myBus.on('changed', () => {});      // when anything is changed
myBus.on('*', () => {});            // any message at all
```

In other words, listeners will hear the channel they signed up for and any
channels that are more specific.

So one sent message will trigger either 3 or 2 channels depending on if it has an id or not.  Of course there may not be listeners on some of those channels, or there may be many callbacks registered on some of those channels.

The arguments of the listener callback are `(channel, data)`.  Channel will be the most specific channel name, not the channel name that was subscribed to.  So, for example, a `'*'` listener can still tell what kinds of messages it's hearing.

## Constructing a channel name with an id

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

# Typescript: using stricter generic types

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

# Error handling

Superbus tries to internally catch all errors from listener callbacks and swallow them so they don't break the sender's code.  These errors will be logged with `console.error`.

Some listener callback errors will become unhandled promise rejections.

# FAQ

## Can I send a message from inside a listener callback?

I have not tried this, but I think it's safe.

In blocking mode, the original outer `sendAndWait` will not complete until the inner, nested `sendAndWait` completes.


## There should be a generic type parameter for the data payload too.

Agreed, PR accepted :)

## Can we specify more strict specific data payload types for each different channel name?

Not currently.  This is very tricky to do, especially because channel names that have ids are made at runtime and not known in advance.

## What order are callbacks called in?

For a specific message, the callbacks are always launched in order from most specific to least specific: all listeners for `changed:123`, then all listeners for `changed`, and then all listeners for `*`.

But note that async callbacks are run in parallel, e.g. we don't wait for one to finish before launching the next one during the sending of a single message.

When multiple listeners have been added to a single channel, they run in the order they were added.

## When exactly do callbacks run?

For `sendLater` they are launched on `process.nextTick`, nonblockingly.

For `sendAndWait`, they are launched synchronously and then awaited using `Promise.all(promises).finally()`.  This means that synchronous callbacks will run inline, blockingly, and async callbacks will be awaited.

If you call `sendAndWait` without awaiting it, the synchronous callbacks should still be run blockingly and will complete before `sendAndWait` exits.  The async callbacks will not be awaited; but I think the parts of those functions before the first `await` will be run blockingly.  TODO: test this more carefully.

## Can callback invocations be coalesced or debounced?

Not by this package, but you can do it yourself using a package like [lodash.debounce](https://www.npmjs.com/package/lodash.debounce) or [debounce](https://www.npmjs.com/package/debounce).

## Does Superbus ensure that messages are really handled one at a time?

Under certain circumstances.

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

The only thing that keeps the listeners from overlapping is the `await` on `sendAndWait`.  There's no lock or other special mechanism.

### When it won't work

If you send messages from various places in your code at the same time, the listeners can overlap.  Everything depends on that `await` holding you back until the next `send`...

```ts
// these will both run at the same time
// overlapping the listeners' execution

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

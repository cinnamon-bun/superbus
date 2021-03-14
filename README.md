# Superbus

A message bus with a few tricks up its sleeve.

You can send **messages** to **channels**, and each message can have a data payload.  You can subscribe to a channel with a callback.

Channels can have different levels of specificity, and subscribers are triggered by their channel and anything more specific.

There's special handling for async callbacks so that you can be sure they're all finished running after you send a message.

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
myBus.on('something', (channel, data) => {
    // channel is the name of the channel again, 'something'
    // data is any payload that came with the message.
});
```

When you subscribe you get an unsubscribe function back:

```ts
let unsub = myBus.on('something', () => {});
unsub();
```

You can also subscribe with an `async` function:

```ts
myBus.on('something', async (channel, data) => {
    await do_something_async_here();
});
```

# Sending: special async behavior

There are two ways to send a message:

```ts
myBus.sendLater('hello', data);
await myBus.sendAndWait('hello', data);
```

The `data` argument is optional.  It defaults to undefined.

## Sending later

sendLater sends your message on process.nextTick:

```ts
myBus.sendLater('hello');
// at this point, listeners have not run yet.
// they will not start running until nextTick.
console.log('listeners have not run yet');
```

## Sending with backpressure

sendAndWait runs the listener callbacks right away and waits for them all to finish,
even the async ones.  Make sure to "await" it.

```ts
await myBus.sendAndWait('hello');
// at this point, all listener callbacks are done running.
console.log('listeners have all finished running.');
```

The async callbacks are run in parallel and we wait for them to all
to finish using Promise.allSettled().

If you forget the "await" on sendAndWait, only the synchronous callbacks will finish
running before your code continues.  The async callbacks will be started but won't
finish until later.

# Message specificity, `*` listeners, and special handling of messages with ids

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

## Constructing a channel name with an id

Only the first colon is detected:

```
sending "changed:a:b:c"
is considered to be the channel "changed" with id "a:b:c".

it will trigger listeners for: "changed:a:b:c", "changed", and "*"
```

The default separator character is colon `:` but you can change it in the constructor:

```ts
let myBus = new Superbus('/');
myBus.sendLater('added/abc');
```

# Stricter generic types

The allowed channel names can be specified in the generic type.  It must be a subtype of `string`.

```ts
// default
new Superbus<string>();

// only allow certain channel names
type MyChannels = 'open' | 'close';
new Superbus<MyChannels>();
```

If you set specific channel names this way, you'll have to give Typescript some extra help when you use ids:

```ts
myBus.sendLater('open:123' as 'open'); 
myBus.on('open:123' as 'open', () => {});
```

# Error handling

TODO.  When callbacks throw errors, the behavior is not well defined yet.

# FAQ

## Can I send a message from inside a listener callback?

Yes, I think this is safe even with async callbacks and `sendAndWait`.  The original, outer `sendAndWait` will not complete until the nested `sendAndWait` completes.

## There should be a generic type parameter for the data payload too.

Agreed, PR accepted :)

## Can we specify more strict specific data payload types for each different channel name?

Not currently.  This is very tricky to do, especially because channel names that have ids are made at runtime and not known in advance.

## What order are callbacks called in?

For a specific message, the callbacks are always launched in order from most specific to least specific: all callbacks for `changed:123`, then all callbacks for `changed`, and then all callbacks for `*`.

But note that async callbacks are run in parallel, e.g. we don't wait for one to finish before launching the next one during the sending of a single message.

When multiple listeners have been added to a single channel, they run in the order they were added.

## When exactly do callbacks run?

For `sendLater` they are launched on `process.nextTick`, nonblockingly.

For `sendAndWait`, they are launched synchronously and then awaited using `Promise.all(promises).finally()`.  This means that synchronous callbacks will run inline, blockingly, and async callbacks will be awaited.

If you call `sendAndWait` without awaiting it, the synchronous callbacks should still be run blockingly and will complete before `sendAndWait` exits.  The async callbacks will not be awaited; but I think the parts of those functions before the first `await` will be run blockingly.  TODO: test this more carefully.

## Can callback invocations be coalesced or debounced?

Not by this package, but you can do it yourself using a package like [lodash.debounce](https://www.npmjs.com/package/lodash.debounce) or [debounce](https://www.npmjs.com/package/debounce).

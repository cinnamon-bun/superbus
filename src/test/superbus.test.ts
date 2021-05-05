import t = require('tap');
//t.runOnly = true;

import {
    Superbus,
} from '../index';
    
//================================================================================ 
// UTILS

//let log = console.log;
let log = (...args: any[]) => {};
let handlerdebug = '   🖐';

let sleep = (ms: number) =>
    new Promise((res, rej) =>
        setTimeout(res, ms));

//================================================================================ 

t.test('bus: type inference for * channels', async (t: any) => {

    type Channels = 'open' | 'close';  // '*' is not included here...

    let bus = new Superbus<Channels>();

    bus.on('open', (channel) => {});
    bus.on('*', (channel) => {});  // but we can still subscribe to '*'.

    // this should be a type error on the '*'
    // since you can't send to '*'
    //await bus.sendAndWait('*');

    t.done();
});

t.test('bus: basics', async (t: any) => {
    let bus = new Superbus();

    let logs: string[] = [];
    bus.on('open', (channel) => { logs.push('a-'+channel); });
    let unsubB = bus.on('close', (channel) => { logs.push('b-'+channel); });

    logs.push('-start');

    await bus.sendAndWait('open');
    await bus.sendAndWait('close');

    logs.push('-end');

    t.same(logs, '-start a-open b-close -end'.split(' '), 'logs in order');

    logs = [];
    unsubB();
    await bus.sendAndWait('open');
    await bus.sendAndWait('close');
    bus.removeAllSubscriptions();
    await bus.sendAndWait('open');
    t.same(logs, ['a-open'], 'logs end after removing all subscriptions');

    t.done();
});

t.test('bus: once', async (t: any) => {
    let bus = new Superbus();

    let logs: string[] = [];

    // b is subscribed first
    let unsubNonblocking = bus.once('open', (channel) => {
        logs.push('b-'+channel);
    }, { mode: 'nonblocking' });

    // then a
    let unsubBlocking = bus.once('open', (channel) => {
        logs.push('a-'+channel);
    }, { mode: 'blocking' });

    logs.push('-start');

    await bus.sendAndWait('open');
    await bus.sendAndWait('open');


    // a runs first because it's blocking
    // b hasn't run yet because it's waiting for setTimeout
    t.same(logs, '-start a-open'.split(' '), 'logs in order, callback was only called once, only blocking callback happened so far');

    // give time for setImmediate things to happen
    await sleep(20);

    logs.push('-end');

    // now b has had a chance to run
    t.same(logs, '-start a-open b-open -end'.split(' '), 'logs in order, callback was only called once, now nonblocking callback also happened');

    unsubBlocking(); // unsub again; this should not crash
    unsubNonblocking(); // unsub again; this should not crash

    t.done();
});

t.test('bus: multi-subscribe with sendAndWait', async (t: any) => {
    let bus = new Superbus();

    let logs = [];
    log('-');
    bus.on(['open', 'close'], (channel) => {
        log(`${handlerdebug} open and close handler got: "${channel}"`);
        logs.push('a-'+channel);
    });
    log('-');
    bus.on('*', (channel) => {
        log(`${handlerdebug} star handler got: "${channel}"`);
        logs.push('b-'+channel);
    });
    log('-');

    //log(bus._subsAndCounts());

    logs.push('-start');

    log('-');
    await bus.sendAndWait('open');
    log('-');
    await bus.sendAndWait('banana');
    log('-');
    await bus.sendAndWait('close');
    log('-');

    logs.push('-end');

    t.same(logs, `
        -start
        a-open
        b-open
        b-banana
        a-close
        b-close
        -end`.trim().split('\n').map(x => x.trim())
        , 'logs in order');

    t.done();
});

t.test('bus: channels with ids', async (t: any) => {
    let bus = new Superbus();

    let logs = [];
    log('-');
    bus.on('changed', (channel) => {
        log(`${handlerdebug} changed handler got: "${channel}"`);
        logs.push('c-'+channel);
    });
    log('-');
    bus.on('changed:12345', (channel) => {
        log(`${handlerdebug} changed:12345 handler got: "${channel}"`);
        logs.push('cid-'+channel);
    });
    log('-');
    bus.on('*', (channel) => {
        log(`${handlerdebug} star handler got: "${channel}"`);
        logs.push('*-'+channel);
    });
    log('-');

    //log(bus._subsAndCounts());

    logs.push('-start');

    log('-');
    await bus.sendAndWait('changed');
    log('-');
    await bus.sendAndWait('zzz');
    log('-');
    await bus.sendAndWait('changed:12345');
    log('-');

    logs.push('-end');

    // a channel gets expanded in order from most to least specific: changed:12345, changed, *.
    // the callbacks are called in the same order, most specific to least.
    // the channel given to the callback is always the original, most specific version of the channel.

    t.same(logs, `
        -start
        c-changed
        *-changed
        *-zzz
        cid-changed:12345
        c-changed:12345
        *-changed:12345
        -end`.trim().split('\n').map(x => x.trim())
        , 'logs in order');

    t.done();
});

interface Event {
    id: string,
    channel: string,
    data: any;
}
t.test('bus: channels with ids and extra separators', async (t: any) => {
    let bus = new Superbus();
    let events: Event[] = [];

    bus.on('changed', (channel, data) => {
        events.push({ id: 'c', channel, data });
    });
    bus.on('changed:aaa', (channel, data) => {
        events.push({ id: 'c:aaa', channel, data });
    });
    bus.on('changed:aaa:bbb', (channel, data) => {
        events.push({ id: 'c:aaa:bbb', channel, data });
    });
    bus.on('*', (channel, data) => {
        events.push({ id: 'star', channel, data });
    });

    await bus.sendAndWait('changed:aaa:bbb', 123);  // two colons
    t.same(events, [
        // c:aaa should not be triggered
        { id: 'c:aaa:bbb', channel: 'changed:aaa:bbb', data: 123 },
        { id: 'c',         channel: 'changed:aaa:bbb', data: 123 },
        { id: 'star',      channel: 'changed:aaa:bbb', data: 123 },
    ], 'events match');
    t.done();
});

t.test('bus: sendAndWait', async (t: any) => {
    let bus = new Superbus();

    let logs = [];
    bus.on('event', async (channel) => {
        await sleep(20);
        logs.push('a1-'+channel);
    });
    bus.on('event', async (channel) => {
        await sleep(40);
        logs.push('a2-'+channel);
    });
    bus.on('event', async (channel) => {
        await sleep(60);
        logs.push('a3-'+channel);
    });
    bus.on('event', (channel) => { logs.push('s-'+channel); });

    bus.on('before', (channel) => { logs.push('s-'+channel); });
    bus.on('after', (channel) => { logs.push('s-'+channel); });

    //log(bus._subsAndCounts());

    logs.push('-start');

    await bus.sendAndWait('before');
    await bus.sendAndWait('event');
    await bus.sendAndWait('after');

    logs.push('-end');

    // TODO:
    // if you subscribe to 'changed'
    // and get sent 'changed:12345',
    // which should you receive in your callback?
    // for now it's 'changed'.

    t.same(logs, `
        -start
        s-before
        s-event
        a1-event
        a2-event
        a3-event
        s-after
        -end`.trim().split('\n').map(x => x.trim())
        , 'logs in order');

    t.done();
});

t.test('bus: sendLater', async (t: any) => {
    let bus = new Superbus();

    let logs = [];
    bus.on('event', async (channel) => {
        await sleep(20);
        logs.push('a1-'+channel);
    });
    bus.on('event', async (channel) => {
        await sleep(40);
        logs.push('a2-'+channel);
    });
    bus.on('event', async (channel) => {
        await sleep(60);
        logs.push('a3-'+channel);
    });
    bus.on('event', (channel) => { logs.push('s-'+channel); });

    bus.on('before', (channel) => { logs.push('s-'+channel); });
    bus.on('after', (channel) => { logs.push('s-'+channel); });

    //log(bus._subsAndCounts());

    logs.push('-start');

    bus.sendLater('before');
    bus.sendLater('event');
    bus.sendLater('after');

    logs.push('-end');

    await sleep(80);
    log(JSON.stringify(logs, null, 4));

    // TODO:
    // if you subscribe to 'changed'
    // and get sent 'changed:12345',
    // which should you receive in your callback?
    // for now it's 'changed'.

    // the s- ones run nextTick but they're synchronous, so they
    // happen fast.
    // the a- ones start nextTick but sleep for various times
    // so they happen later.
    t.same(logs, `
        -start
        -end
        s-before
        s-event
        s-after
        a1-event
        a2-event
        a3-event
        `.trim().split('\n').map(x => x.trim())
        , 'logs in order');

    t.done();
});

t.test('bus: mix of sync and async callbacks', async (t: any) => {
    let bus = new Superbus();
    let successLog: string[] = [];

    bus.on('hello', async (channel, data) => {
        successLog.push('success1');
    });
    bus.on('hello', (channel, data) => {
        successLog.push('success2');
    });
    bus.on('hello', async (channel, data) => {
        successLog.push('success3');
    });
    bus.on('hello', (channel, data) => {
        successLog.push('success4');
    });

    successLog = [];
    await bus.sendAndWait('hello');
    successLog.sort();
    t.same(successLog, 'success1 success2 success3 success4'.split(' '), 'mixed sync and a sync callbacks all ran using sendAndWait');

    successLog = [];
    bus.sendLater('hello');
    await sleep(50);
    successLog.sort();
    t.same(successLog, 'success1 success2 success3 success4'.split(' '), 'mixed sync and a sync callbacks all ran using sendLater');

    t.done();
});

//================================================================================
// blocking and nonblocking callbacks

t.test('bus: mix of blocking and nonblocking callbacks', async (t: any) => {
    let bus = new Superbus();
    let logs: string[] = [];

    bus.on('hello', async (channel, data) => {
        logs.push('async-nonblock');
        await sleep(30);
        logs.push('async-nonblock2');
    }, { mode: 'nonblocking' });
    bus.on('hello', (channel, data) => {
        logs.push('sync-nonblock');
    }, { mode: 'nonblocking' });

    bus.on('hello', async (channel, data) => {
        logs.push('async-block');
        await sleep(30);
        logs.push('async-block2');
    }, { mode: 'blocking' });
    bus.on('hello', (channel, data) => {
        logs.push('sync-block');
    }, { mode: 'blocking' });

    logs = [];
    logs.push('-start-');
    await bus.sendAndWait('hello');
    logs.push('-nextTick-');
    await sleep(50);
    logs.push('-end-');
    //console.log(logs);
    // 0. -start-
    // | (launch async-nonblock on next-tick)
    // | (launch sync-nonblock on next-tick)
    // | 1. run async-block now
    // | 2. run sync-block now
    // | (await async-block)
    // |     (nextTick)
    // |     3. async-nonblock runs
    // |     4. sync-nonblock runs
    // | 5. async-block2 finishes waiting
    // | (return from sendAndWait)
    // 6. (nextTick)
        // 7. async-nonblock2 finishes waiting
    // sleep 50
    // 8. -end-
    t.same(logs, [
        '-start-', // 0
        'async-block',  // 1
        'sync-block',   // 2
        'async-nonblock',  // 3
        'sync-nonblock',   // 4
        'async-block2',    // 5
        '-nextTick-',      // 6
        'async-nonblock2', // 7
        '-end-',  // 8
    ], 'await sendAndWait() with all combos of async/sync blocking/nonblocking callbacks');

    logs = [];
    logs.push('-start-');
    bus.sendAndWait('hello');  // no await
    logs.push('-nextTick-');
    await sleep(50);
    logs.push('-end-');
    //console.log(logs);
    // 0. -start-
    // | (launch async-nonblock on next-tick)
    // | (launch sync-nonblock on next-tick)
    // | 1. run async-block now
    // | 2. run sync-block now
    // | return from sendAndWait
        // 6. (nextTick)
        // 3. async-nonblock runs
        // 4. sync-nonblock runs
    // 5. async-block2 finishes waiting
    // 7. async-nonblock2 finishes waiting
    // sleep 50
    // 8. -end-
    t.same(logs, [
        '-start-', // 0
        'async-block',  // 1
        'sync-block',   // 2
        '-nextTick-',      // 6
        'async-nonblock',  // 3
        'sync-nonblock',   // 4
        'async-block2',    // 5
        'async-nonblock2', // 7
        '-end-',  // 8
    ], 'sendAndWait() (no await) with all combos of async/sync blocking/nonblocking callbacks');


    t.done();
});


// TODO: test sendAndWait without awaiting it

//================================================================================
// ERROR HANDLING

t.test('bus: error thrown from sync callback and await sendAndWait', async (t: any) => {
    let bus = new Superbus();
    // add a safe listener which does not throw an exception
    bus.on('hello', (channel, data) => { });
    let errors = await bus.sendAndWait('hello');
    t.same(errors, null, 'errors should be null');

    // add a subscriber which throws an error
    bus.on('hello', (channel, data) => { throw new Error('oopsBlockingSync'); });
    bus.on('hello', (channel, data) => { throw new Error('oopsBlockingSync'); });
    errors = await bus.sendAndWait('hello');
    if (errors === null) {
        t.ok(false, 'errors should not be null');
    } else {
        t.same(errors.length, 2, 'should have collected two errors');
        t.same([errors[0].name, errors[0].message], ['Error', 'oopsBlockingSync'], 'it was the expected error');
    }

    t.done();
});

t.test('bus: error thrown from async callback and await sendAndWait', async (t: any) => {
    let bus = new Superbus();
    // add a safe listener which does not throw an exception
    bus.on('hello', async (channel, data) => { });
    let errors = await bus.sendAndWait('hello');
    t.same(errors, null, 'errors should be null');

    // add a subscriber which throws an error
    bus.on('hello', async (channel, data) => { throw new Error('oopsBlockingAsync'); });
    bus.on('hello', async (channel, data) => { throw new Error('oopsBlockingAsync'); });
    errors = await bus.sendAndWait('hello');
    if (errors === null) {
        t.ok(false, 'errors should not be null');
    } else {
        t.same(errors.length, 2, 'should have collected two errors');
        t.same([errors[0].name, errors[0].message], ['Error', 'oopsBlockingAsync'], 'it was the expected error');
    }

    t.done();
});

//================================================================================
// UNHANDLED PROMISE REJECTIONS
// (how to test for these?)

t.skip('bus: error thrown from nonblocking sync callback and await sendAndWait', async (t: any) => {
    // this causes an unhandledRejection which I don't know how to test for
    let bus = new Superbus();
    bus.on('hello', (channel, data) => { throw new Error('oops1'); }, { mode: 'nonblocking' });
    let errors = await bus.sendAndWait('hello');
    await sleep(50);
    t.done();
});
t.skip('bus: error thrown from nonblocking async callback and await sendAndWait', async (t: any) => {
    // this causes an unhandledRejection which I don't know how to test for
    let bus = new Superbus();
    bus.on('hello', async (channel, data) => { throw new Error('oops2'); }, { mode: 'nonblocking' });
    let errors = await bus.sendAndWait('hello');
    await sleep(50);
    t.done();
});
t.skip('bus: error thrown from sync callback and sendLater', async (t: any) => {
    // this causes an unhandledRejection which I don't know how to test for
    let bus = new Superbus();
    bus.on('hello', (channel, data) => { throw new Error('oops3'); });
    bus.sendLater('hello');
    await sleep(50);
    t.done();
});
t.skip('bus: error thrown from async callback and sendLater', async (t: any) => {
    // this causes an unhandledRejection which I don't know how to test for
    let bus = new Superbus();
    bus.on('hello', async (channel, data) => { throw new Error('oops4'); });
    bus.sendLater('hello');
    await sleep(50);
    t.done();
});

t.test('bus: error in the middle of several callbacks', async (t: any) => {
    let bus = new Superbus();

    let successLog: string[] = [];
    bus.on('hello', async (channel, data) => {
        successLog.push('success1');
    });
    bus.on('hello', (channel, data) => {
        successLog.push('success2');
    });
    bus.on('hello', (channel, data) => {
        throw new Error('oops1');
    });
    bus.on('hello', async (channel, data) => {
        throw new Error('oops2');
    });
    bus.on('hello', async (channel, data) => {
        successLog.push('success3');
    });
    bus.on('hello', (channel, data) => {
        successLog.push('success4');
    });

    let errors = await bus.sendAndWait('hello');
    t.notSame(errors, null, 'some errors were thrown');
    t.same(errors?.length, 2, 'two errors were thrown');

    t.same(successLog, 'success1 success2 success3 success4'.split(' '), 'all callbacks run even if some in the middle have errors');

    t.done();
});

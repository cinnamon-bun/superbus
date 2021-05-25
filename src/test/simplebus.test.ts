import t = require('tap');
//t.runOnly = true;

import {
    Simplebus,
} from '../simplebus';
    
//================================================================================ 
// UTILS

//let log = console.log;
let log = (...args: any[]) => {};
let handlerdebug = '   🖐';

let sleep = (ms: number) =>
    new Promise((res, rej) =>
        setTimeout(res, ms));

//================================================================================ 

t.test('simplebus basics', async (t: any) => {
    type Data = 'open' | 'close';

    let bus = new Simplebus<Data>();
    let logs: string[] = [];
    logs.push('-start');

    bus.on((data: Data) => { logs.push(data) });

    await bus.send('open');
    await bus.send('close');

    logs.push('-end');
    t.same(logs, ['-start', 'open', 'close', '-end'], 'logs are as expected');
    t.done();
});

t.test('simplebus once', async (t: any) => {
    type Data = string;

    let bus = new Simplebus<Data>();
    let logs: string[] = [];
    logs.push('-start');

    // even if the once cb is defined first, once-cbs run after regular cbs
    bus.once((data: Data) => { logs.push(data + '-b') });
    bus.on((data: Data) => { logs.push(data + '-a') });

    await bus.send('1');
    await bus.send('2');

    logs.push('-end');
    t.same(logs, ['-start', '1-a', '1-b', '2-a', '-end'], 'logs are as expected');
    t.done();
});

t.test('simplebus deadlock avoidance', async (t: any) => {
    type Data = string

    let bus = new Simplebus<Data>();
    let logs: string[] = [];
    logs.push('-start');

    // when data doesn't end with "!", send it again with "!" on the end.
    bus.on(async (data: Data) => {
        logs.push(data);
        if (!data.endsWith('!')) {
            // Since we're sending from inside an event handler, the lock is active.
            // We have to disable the lock to avoid deadlock.
            // Try not to do this.
            await bus.send(data + '!', { useLock: false });
        }
    });

    await bus.send('hello');

    await sleep(100);

    logs.push('-end');
    t.same(logs, ['-start', 'hello', 'hello!', '-end'], 'logs are as expected');
    t.done();
});

t.test('simplebus error handling', async (t: any) => {
    type Data = string;
    let bus = new Simplebus<Data>();
    let logs: string[] = [];
    logs.push('-start');

    bus.on((data: Data) => { logs.push(data + '-a') });
    bus.on((data: Data) => { logs.push(data + '-b') });
    bus.on((data: Data) => { throw new Error('oops'); });
    bus.on((data: Data) => { logs.push(data + '-c') });  // this won't happen because of the previous error

    try {
        await bus.send('1');
        t.ok(false, 'callback error was not thrown??');
    } catch (err) {
        t.same(err.message, 'oops', 'callback error was caught');
    }

    logs.push('-end');
    t.same(logs, ['-start', '1-a', '1-b', '-end'], 'logs are as expected; error stopped later callbacks from running');
    t.done();
});

t.test('simplebus lock', async (t: any) => {
    type Data = string;

    let bus = new Simplebus<Data>();
    let logs: string[] = [];
    logs.push('-start');

    // these handlers will fail if run simultaneously
    let runningHandler: string | null = null;
    let unsubA = bus.on(async (data: Data) => {
        let handlerName = 'a';
        t.same(runningHandler, null, `starting ${handlerName} - no handler should be running right now.  data = ${data}`);
        runningHandler = handlerName
        await sleep(30);
        logs.push(data + '-' + handlerName);
        runningHandler = null;
        t.ok(true, `ending ${handlerName}`);
    });
    let unsubB = bus.on(async (data: Data) => {
        let handlerName = 'b';
        t.same(runningHandler, null, `starting ${handlerName} - no handler should be running right nowdata = ${data}`);
        runningHandler = handlerName
        await sleep(30);
        logs.push(data + '-' + handlerName);
        runningHandler = null;
        t.ok(true, `ending ${handlerName}`);
    });

    let p1 = bus.send('1');
    let p2 = bus.send('2');
    await Promise.all([p1, p2]);

    t.same(logs, ['-start', '1-a', '1-b', '2-a', '2-b'], 'handlers ran in series, not parallel, even without awaiting each one');

    t.ok(true, 'unsubbing a');
    unsubA();
    await bus.send('3');
    t.same(logs, ['-start', '1-a', '1-b', '2-a', '2-b', '3-b'], 'unsub works');

    t.ok(true, 'removing all subscribers');
    bus.removeAllSubscribers();
    await bus.send('4');
    t.same(logs, ['-start', '1-a', '1-b', '2-a', '2-b', '3-b'], 'removeAllSubscribers works');

    t.done();
});


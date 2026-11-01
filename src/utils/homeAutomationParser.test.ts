import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHomeAutomationCommand,
  parseArduinoResponse,
  normalizeCommandText,
  DEFAULT_DEVICES,
} from './homeAutomationParser';

test('normalizeCommandText strips punctuation and handles whitespace', () => {
  assert.equal(normalizeCommandText('   On, Light!  '), 'on light');
  assert.equal(normalizeCommandText('Turn OFF: the fan???'), 'turn off the fan');
});

test('parses "on light" to Living Room Light Relay Pin 7', () => {
  const res = parseHomeAutomationCommand('on light');
  assert.equal(res.matched, true);
  assert.equal(res.action, 'ON');
  assert.equal(res.targetPin, 7);
  assert.equal(res.targetState, true);
  assert.equal(res.serialPacket, 'RELAY:7:1\n');
});

test('parses "turn off light" to Relay Pin 7 OFF', () => {
  const res = parseHomeAutomationCommand('turn off light');
  assert.equal(res.matched, true);
  assert.equal(res.action, 'OFF');
  assert.equal(res.targetPin, 7);
  assert.equal(res.targetState, false);
  assert.equal(res.serialPacket, 'RELAY:7:0\n');
});

test('parses "on fan" and "stop fan" to Relay Pin 6', () => {
  const resOn = parseHomeAutomationCommand('on fan');
  assert.equal(resOn.matched, true);
  assert.equal(resOn.action, 'ON');
  assert.equal(resOn.targetPin, 6);
  assert.equal(resOn.serialPacket, 'RELAY:6:1\n');

  const resOff = parseHomeAutomationCommand('stop fan');
  assert.equal(resOff.matched, true);
  assert.equal(resOff.action, 'OFF');
  assert.equal(resOff.targetPin, 6);
  assert.equal(resOff.serialPacket, 'RELAY:6:0\n');
});

test('parses fan speed commands like "fan speed 3" and "fan speed 80"', () => {
  const res1 = parseHomeAutomationCommand('fan speed 3');
  assert.equal(res1.matched, true);
  assert.equal(res1.action, 'SPEED');
  assert.equal(res1.speedValue, 60); // 3 * 20%
  assert.equal(res1.serialPacket, 'FAN_SPEED:60\n');

  const res2 = parseHomeAutomationCommand('fan speed 80');
  assert.equal(res2.matched, true);
  assert.equal(res2.action, 'SPEED');
  assert.equal(res2.speedValue, 80);
  assert.equal(res2.serialPacket, 'FAN_SPEED:80\n');
});

test('parses AC commands correctly to Pin 5', () => {
  const res = parseHomeAutomationCommand('turn on ac');
  assert.equal(res.matched, true);
  assert.equal(res.targetPin, 5);
  assert.equal(res.serialPacket, 'RELAY:5:1\n');
});

test('parses "kitchen light off" to Pin 4 without colliding with generic light', () => {
  const res = parseHomeAutomationCommand('kitchen light off');
  assert.equal(res.matched, true);
  assert.equal(res.targetPin, 4);
  assert.equal(res.targetState, false);
  assert.equal(res.serialPacket, 'RELAY:4:0\n');
});

test('parses global actions "all on" and "goodnight" (all off)', () => {
  const resAllOn = parseHomeAutomationCommand('all on');
  assert.equal(resAllOn.action, 'ALL_ON');
  assert.equal(resAllOn.serialPacket, 'ALL:1\n');

  const resAllOff = parseHomeAutomationCommand('goodnight');
  assert.equal(resAllOff.action, 'ALL_OFF');
  assert.equal(resAllOff.serialPacket, 'ALL:0\n');
});

test('parses Arduino incoming responses correctly', () => {
  const ackRelay = parseArduinoResponse('ACK:RELAY:7:1');
  assert.equal(ackRelay.type, 'ACK');
  assert.equal(ackRelay.pin, 7);
  assert.equal(ackRelay.state, true);

  const pong = parseArduinoResponse('PONG:12345', Date.now() - 5);
  assert.equal(pong.type, 'PONG');
  assert.ok(pong.latencyMs! >= 1);

  const stateSync = parseArduinoResponse('STATE:7=1,6=0,5=1,4=0,3=0,2=0');
  assert.equal(stateSync.type, 'STATE');
  assert.equal(stateSync.states?.[7], true);
  assert.equal(stateSync.states?.[6], false);
  assert.equal(stateSync.states?.[5], true);
});

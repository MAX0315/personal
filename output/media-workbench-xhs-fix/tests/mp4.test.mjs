import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMp4 } from '../server/mp4.mjs';

const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
};
const timing = (version, seconds = 2.5) => {
  const payload = Buffer.alloc(version ? 44 : 24);
  payload[0] = version;
  payload.writeUInt32BE(1000, version ? 20 : 12);
  if (version) payload.writeBigUInt64BE(BigInt(seconds * 1000), 24);
  else payload.writeUInt32BE(seconds * 1000, 16);
  return payload;
};
const track = ({ kind = 'vide', codec = 'avc1', version = 0, omitTime = false } = {}) => {
  const tkhd = Buffer.alloc(version ? 96 : 84);
  tkhd[0] = version;
  tkhd.writeUInt32BE(1920 * 65536, version ? 88 : 76);
  tkhd.writeUInt32BE(1080 * 65536, version ? 92 : 80);
  const handler = Buffer.alloc(24);
  handler.write(kind, 8);
  const description = Buffer.alloc(8);
  description.writeUInt32BE(1, 4);
  const sampleEntry = box(codec, Buffer.alloc(kind === 'vide' ? 78 : 28));
  return box('trak', box('tkhd', tkhd), box('mdia', ...(omitTime ? [] : [box('mdhd', timing(version))]), box('hdlr', handler), box('minf', box('stbl', box('stsd', description, sampleEntry)))));
};
const ftyp = () => box('ftyp', Buffer.from('isom\0\0\0\0isommp42', 'latin1'));
const movie = ({ tracks = [track()], movieVersion = 0 } = {}) => Buffer.concat([ftyp(), box('moov', box('mvhd', timing(movieVersion)), ...tracks), box('mdat', Buffer.from([1, 2, 3, 4]))]);

test('reads H.264 video, AAC audio and ordinary version 0 timing', () => {
  assert.deepEqual(inspectMp4(movie({ tracks: [track(), track({ kind: 'soun', codec: 'mp4a' })] })), {
    format: 'mp4', width: 1920, height: 1080, duration: 2.5, videoCodec: 'avc1', audioCodec: 'mp4a', hasAudio: true,
  });
});

test('reads version 1 headers and accepts a Uint8Array subview', () => {
  const sample = movie({ tracks: [track({ codec: 'hvc1', version: 1 })], movieVersion: 1 });
  const padded = Buffer.concat([Buffer.from('padding'), sample, Buffer.from('padding')]);
  const input = new Uint8Array(padded.buffer, padded.byteOffset + 7, sample.length);
  const result = inspectMp4(input);
  assert.equal(result.videoCodec, 'hvc1');
  assert.equal(result.duration, 2.5);
  assert.equal(result.hasAudio, false);
  assert.equal(result.audioCodec, null);
});

test('uses movie duration when a track lacks mdhd', () => {
  assert.equal(inspectMp4(movie({ tracks: [track({ omitTime: true })], movieVersion: 1 })).duration, 2.5);
});

test('rejects an HTML response, missing media, audio-only media and truncated media', () => {
  assert.throws(() => inspectMp4(Buffer.from('<!doctype html><html>blocked</html>')), /MP4/);
  assert.throws(() => inspectMp4(Buffer.concat([ftyp(), box('moov', track())])), /完整/);
  assert.throws(() => inspectMp4(movie({ tracks: [track({ kind: 'soun', codec: 'mp4a' })] })), /视频轨道/);
  const sample = movie();
  assert.throws(() => inspectMp4(sample.subarray(0, sample.length - 1)), /截断/);
});

test('rejects truncated nested sample descriptions and inconsistent entry counts', () => {
  const sample = movie();
  const position = sample.indexOf(Buffer.from('avc1')) - 4;
  sample.writeUInt32BE(5000, position);
  assert.throws(() => inspectMp4(sample), /截断/);
  const mismatch = movie();
  mismatch.writeUInt32BE(2, mismatch.indexOf(Buffer.from('stsd')) + 8);
  assert.throws(() => inspectMp4(mismatch), /编码描述不完整/);
});

test('accepts valid extended-size and final size-zero boxes', () => {
  const extended = Buffer.alloc(20);
  extended.writeUInt32BE(1);
  extended.write('free', 4);
  extended.writeBigUInt64BE(20n, 8);
  const sample = Buffer.concat([extended, movie()]);
  assert.equal(inspectMp4(sample).width, 1920);
  sample.writeUInt32BE(0, sample.lastIndexOf(Buffer.from('mdat')) - 4);
  assert.equal(inspectMp4(sample).height, 1080);
});

test('rejects invalid sizes, oversized extended boxes and excessive nesting', () => {
  const short = movie();
  short.writeUInt32BE(4);
  assert.throws(() => inspectMp4(short), /截断/);
  const extended = Buffer.alloc(16);
  extended.writeUInt32BE(1);
  extended.write('free', 4);
  extended.writeBigUInt64BE(0xffffffffffffffffn, 8);
  assert.throws(() => inspectMp4(Buffer.concat([extended, movie()])), /长度无效/);
  let nested = box('free');
  for (let i = 0; i < 15; i++) nested = box('moov', nested);
  assert.throws(() => inspectMp4(Buffer.concat([ftyp(), nested, box('mdat', Buffer.from([1]))])), /嵌套过深/);
});

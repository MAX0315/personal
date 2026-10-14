import { Buffer } from 'node:buffer';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
const VIDEO_ENTRIES = new Set(['avc1', 'avc2', 'avc3', 'avc4', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09', 'mp4v', 'encv', 'dvh1', 'dvhe', 'jpeg', 'mjpa', 'mjpb', 's263']);
const AUDIO_ENTRIES = new Set(['mp4a', 'enca', 'ac-3', 'ec-3', 'Opus', 'fLaC', 'alac', 'lpcm', 'sowt', 'twos']);
const fail = (message) => { throw new Error(message); };

/** Inspect the MP4 container and track metadata; this does not decode media frames. */
export function inspectMp4(input) {
  if (!(input instanceof Uint8Array)) fail('视频数据类型无效。');
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < 16) fail('下载内容不是完整的 MP4 视频。');
  let boxCount = 0;

  function boxes(start, end, depth = 0) {
    if (depth > 12) fail('MP4 结构嵌套过深，无法验证。');
    const result = [];
    for (let pos = start; pos < end;) {
      if (++boxCount > 50000) fail('MP4 结构过于复杂，无法验证。');
      if (end - pos < 8) fail('MP4 数据被截断，结构不完整。');
      let size = data.readUInt32BE(pos);
      const type = data.toString('latin1', pos + 4, pos + 8);
      let header = 8;
      if (size === 1) {
        if (end - pos < 16) fail('MP4 数据被截断，结构不完整。');
        const extended = data.readBigUInt64BE(pos + 8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) fail('MP4 数据长度无效。');
        size = Number(extended);
        header = 16;
      } else if (size === 0) size = end - pos;
      if (type === 'uuid') header += 16;
      if (size < header || size > end - pos) fail('MP4 数据被截断，结构不完整。');
      const node = { type, payload: pos + header, end: pos + size, children: [] };
      if (CONTAINERS.has(type)) node.children = boxes(node.payload, node.end, depth + 1);
      else if (type === 'stsd') {
        requireLength(node, 8);
        node.children = boxes(node.payload + 8, node.end, depth + 1);
        if (node.children.length !== data.readUInt32BE(node.payload + 4)) fail('MP4 编码描述不完整。');
      } else if (VIDEO_ENTRIES.has(type)) {
        requireLength(node, 78);
        node.children = boxes(node.payload + 78, node.end, depth + 1);
      } else if (AUDIO_ENTRIES.has(type)) {
        requireLength(node, 28);
        const version = data.readUInt16BE(node.payload + 8);
        const length = version === 1 ? 44 : version === 2 ? 64 : 28;
        requireLength(node, length);
        node.children = boxes(node.payload + length, node.end, depth + 1);
      }
      result.push(node);
      pos += size;
    }
    return result;
  }

  function requireLength(node, length) {
    if (node.end - node.payload < length) fail('MP4 视频元数据被截断。');
  }
  const child = (node, type) => node?.children.find((item) => item.type === type);

  function duration(node) {
    if (!node) return null;
    requireLength(node, 4);
    const version = data[node.payload];
    if (version !== 0 && version !== 1) fail('MP4 时间信息版本不支持。');
    requireLength(node, version === 1 ? 32 : 20);
    const scale = data.readUInt32BE(node.payload + (version === 1 ? 20 : 12));
    const ticks = version === 1 ? data.readBigUInt64BE(node.payload + 24) : BigInt(data.readUInt32BE(node.payload + 16));
    if (!scale || ticks === (version === 1 ? 0xffffffffffffffffn : 0xffffffffn)) return null;
    return Number(ticks) / scale;
  }

  const top = boxes(0, data.length);
  const ftyp = top.find((node) => node.type === 'ftyp');
  const moov = top.find((node) => node.type === 'moov');
  const media = top.filter((node) => node.type === 'mdat');
  if (!ftyp || !moov || !media.some((node) => node.end > node.payload)) fail('下载内容不是包含视频数据的完整 MP4 文件。');
  requireLength(ftyp, 8);
  if ((ftyp.end - ftyp.payload) % 4 !== 0) fail('MP4 文件类型信息不完整。');

  const tracks = moov.children.filter((node) => node.type === 'trak').map((track) => {
    const mdia = child(track, 'mdia');
    const handler = child(mdia, 'hdlr');
    if (!handler) return null;
    requireLength(handler, 12);
    const kind = data.toString('latin1', handler.payload + 8, handler.payload + 12);
    if (kind !== 'vide' && kind !== 'soun') return null;
    const descriptions = child(child(child(mdia, 'minf'), 'stbl'), 'stsd');
    const codec = descriptions?.children[0]?.type;
    if (!codec) fail('MP4 缺少视频或音频编码信息。');
    return { kind, codec, track, mdia };
  }).filter(Boolean);
  const video = tracks.find((track) => track.kind === 'vide');
  if (!video) fail('文件只有音频或缺少视频轨道。');
  const tkhd = child(video.track, 'tkhd');
  if (!tkhd) fail('MP4 缺少视频尺寸信息。');
  requireLength(tkhd, 4);
  const version = data[tkhd.payload];
  if (version !== 0 && version !== 1) fail('MP4 视频轨道版本不支持。');
  const offset = version === 1 ? 88 : 76;
  requireLength(tkhd, offset + 8);
  const width = data.readUInt32BE(tkhd.payload + offset) / 65536;
  const height = data.readUInt32BE(tkhd.payload + offset + 4) / 65536;
  const seconds = duration(child(video.mdia, 'mdhd')) || duration(child(moov, 'mvhd'));
  if (!(width > 0 && height > 0 && seconds > 0 && Number.isFinite(seconds))) fail('MP4 视频尺寸或时长无效。');
  const audio = tracks.find((track) => track.kind === 'soun');
  return { format: 'mp4', width, height, duration: seconds, videoCodec: video.codec, audioCodec: audio?.codec || null, hasAudio: Boolean(audio) };
}

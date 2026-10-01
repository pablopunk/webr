export const HEADER_SIZE = 32;
export const MAX_FRAME_BYTES = 256 * 1024;
export type Frame = { streamId: number; generation: number; seq: number; width: number; height: number; full: boolean; bytes: Uint8Array };

export function encodeFrame(frame: Frame): Uint8Array {
  if (frame.bytes.length > MAX_FRAME_BYTES) throw new Error('frame_limit');
  const packet = new Uint8Array(HEADER_SIZE + frame.bytes.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, 0x48445231);
  view.setUint32(4, frame.streamId);
  view.setUint32(8, frame.generation);
  view.setBigUint64(12, BigInt(frame.seq));
  view.setUint16(20, frame.width);
  view.setUint16(22, frame.height);
  view.setUint32(24, frame.bytes.length);
  view.setUint8(28, frame.full ? 1 : 0);
  packet.set(frame.bytes, HEADER_SIZE);
  return packet;
}

export function decodeFrame(packet: Uint8Array): Frame {
  if (packet.length < HEADER_SIZE) throw new Error('short_frame');
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const seq = Number(view.getBigUint64(12));
  if (view.getUint32(0) !== 0x48445231 || view.getUint32(24) !== packet.length - HEADER_SIZE || packet.length - HEADER_SIZE > MAX_FRAME_BYTES || !Number.isSafeInteger(seq) || view.getUint8(28) > 1 || view.getUint8(29) || view.getUint16(30)) throw new Error('invalid_frame');
  const frame = { streamId: view.getUint32(4), generation: view.getUint32(8), seq, width: view.getUint16(20), height: view.getUint16(22), full: !!view.getUint8(28), bytes: packet.subarray(HEADER_SIZE) };
  if (!frame.streamId || !frame.generation || !frame.width || frame.width > 500 || !frame.height || frame.height > 300) throw new Error('invalid_dimensions');
  return frame;
}

export class FrameSequence {
  private seq: number | undefined;
  accept(frame: Frame) {
    if (this.seq === undefined && !frame.full) throw new Error('baseline_required');
    if (this.seq !== undefined && frame.seq !== this.seq + 1) throw new Error('sequence_gap');
    this.seq = frame.seq;
  }
}

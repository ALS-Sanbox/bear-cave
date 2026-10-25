import sharp from 'sharp';
export async function validateExternalImage(data: Uint8Array,signal?:AbortSignal) {
    imageExtension(data);signal?.throwIfAborted();
    await sharp(Buffer.from(data),{limitInputPixels:40000000}).stats();
    signal?.throwIfAborted();
}
export function imageExtension(data: Uint8Array): string {
    const b = Buffer.from(data);
    if (b.length >= 12 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.subarray(-8, -4).toString() === 'IEND') return 'png';
    if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217) return 'jpg';
    if (b.length >= 16 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) return 'webp';
    throw Error('Downloaded page is not a complete PNG, JPEG or WebP image.');
}

export function getLastFmApiSig(data: {[key: string]: any}, secret: string): string {
    // Sort keys alphabetically
    const sortedKeys = Object.keys(data).sort();

    // Concatenate parameters in name+value format
    const concatenatedString = sortedKeys.reduce((acc, key) => {
        // Ensure values are properly encoded
        const value = encodeURIComponent(data[key].toString());
        return acc + key + value;
    }, '');

    // Append secret
    const stringToHash = concatenatedString + secret;

    // Generate MD5 hash
    return md5(stringToHash);
}

// Per-round shift amounts and the sine-derived constants of RFC 1321.
const SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/**
 * MD5 of the UTF-8 bytes of `text`, as lowercase hex (what Node's
 * `createHash('md5').update(text).digest('hex')` returns).
 *
 * Browsers have no MD5 (Web Crypto refuses it), and the Node `crypto`
 * polyfill this replaced pulled crypto-browserify — elliptic, bn.js and a
 * `stream` shim — into the bundle for this one call.
 */
export function md5(text: string): string {
    const bytes = new TextEncoder().encode(text);
    // Pad to 56 mod 64 bytes, then append the bit length as 64-bit little endian.
    const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let chunk = 0; chunk < padded.length; chunk += 64) {
        let a = a0, b = b0, c = c0, d = d0;
        for (let i = 0; i < 64; i++) {
            let f: number, g: number;
            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) % 16;
            }
            const sum = (a + f + K[i] + view.getUint32(chunk + g * 4, true)) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((sum << SHIFTS[i]) | (sum >>> (32 - SHIFTS[i])))) | 0;
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + b) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }

    const out = new DataView(new ArrayBuffer(16));
    [a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true));
    return Array.from(new Uint8Array(out.buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

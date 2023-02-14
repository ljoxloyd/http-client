export function isArrayBufferView(body: object): body is ArrayBufferView {
    return "buffer" in body && body.buffer instanceof ArrayBuffer;
}

export function keys<T extends object>(object: T) {
    return Object.keys(object) as Array<keyof T>;
}

export function lazy<T>(thing: T) {
    return () => thing;
}

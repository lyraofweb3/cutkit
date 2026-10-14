declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(type: string, data: Float32Array | Uint8Array | Int32Array | BigInt64Array | Float64Array, dims?: number[])
    data: Float32Array | Uint8Array | Int32Array
    dims: number[]
  }
  export class InferenceSession {
    static create(uri: string | ArrayBuffer | Uint8Array, options?: object): Promise<InferenceSession>
    run(feeds: Record<string, Tensor>, options?: object): Promise<Record<string, Tensor>>
    inputNames: string[]
    outputNames: string[]
  }
  export const env: { wasm: { numThreads: number; simd: boolean; wasmPaths: string | { [k: string]: string } } }
}

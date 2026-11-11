// esbuild injects this lexical import only where browser dependencies use Buffer.
// Do not depend on Node globals or mutate window.Buffer.
export {Buffer} from 'buffer/';

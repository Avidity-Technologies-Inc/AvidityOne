// Jest 29 cannot require the ESM parser used by the patched HTML sanitizer.
// Production Node loads the original modules; tests preserve their behavior.
const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    return { code: transformSync(source, { format: 'cjs', platform: 'node', target: 'node22', sourcefile: filename, sourcemap: 'inline' }).code };
  }
};

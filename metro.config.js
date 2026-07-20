const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// react-native-skia's web backend (CanvasKit) ships a .wasm binary; Metro
// doesn't recognize that extension as an asset by default, so requests for
// it were falling through to the dev server's HTML 404 page instead of the
// actual binary.
config.resolver.assetExts.push('wasm');

module.exports = config;

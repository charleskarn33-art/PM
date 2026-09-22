// Expo's default Metro config supports pnpm workspaces (the shared package is
// consumed as TypeScript source).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);

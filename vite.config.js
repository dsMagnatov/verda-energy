import { defineConfig } from 'vite';
import { localSettingsPreview } from './scripts/local-settings-preview.mjs';

export default defineConfig({ plugins: [localSettingsPreview()] });

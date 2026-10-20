import { defineConfig } from 'vite';
import { localSettingsPreview } from './scripts/local-settings-preview.mjs';
import publishedSettings from './src/published-scene-settings.json' with { type: 'json' };

export default defineConfig({ plugins: [localSettingsPreview({ initialSettings: publishedSettings })] });

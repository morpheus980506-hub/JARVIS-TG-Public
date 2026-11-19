import path from 'node:path'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'
const config: ForgeConfig = {
  makers: [
    new MakerSquirrel({
      name: 'TravelAgent',
      setupIcon: path.resolve('assets/icon.ico'),
    }),
  ],
  packagerConfig: {
    asar: true,
    icon: path.resolve('assets/icon'),
    extraResource: ['assets/icon.png', 'THIRD_PARTY_NOTICES.md'],
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
}
export default config

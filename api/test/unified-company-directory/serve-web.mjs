import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const web = fileURLToPath(new URL('../../../web/', import.meta.url));
const requireWeb = createRequire(path.join(web, 'package.json'));
const load = async name => import(pathToFileURL(requireWeb.resolve(name)).href);
const { createServer } = await import(pathToFileURL(path.join(path.dirname(requireWeb.resolve('vite/package.json')), 'dist/node/index.js')).href);
const plugin = module => module.default?.default ?? module.default;
const vue = plugin(await load('@vitejs/plugin-vue'));
const autoImport = plugin(await load('unplugin-auto-import/vite'));
const components = plugin(await load('unplugin-vue-components/vite'));
const { ElementPlusResolver } = await load('unplugin-vue-components/resolvers');
const target = new URL(process.env.COMPANY_DIRECTORY_API_URL);
if (target.hostname !== '127.0.0.1' || target.port === '3000') throw new Error('Unsafe isolated API endpoint');
const server = await createServer({
  configFile: false, root: web, envDir: path.resolve(web, '../tmp/company-directory-integration'),
  plugins: [vue(), autoImport({ resolvers: [ElementPlusResolver()], dts: false }),
    components({ resolvers: [ElementPlusResolver()], dts: false })],
  resolve: { alias: { '@': path.join(web, 'src') } },
  server: { host: '127.0.0.1', port: 5190, strictPort: true,
    proxy: { '/api': { target: target.origin, changeOrigin: true } } },
});
await server.listen();
console.log('COMPANY_DIRECTORY_VITE_READY');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });

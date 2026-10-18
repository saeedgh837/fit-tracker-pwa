import type { Plugin } from 'vite';
/**
 * Preloads the two font subsets the first paint needs: Persian body text (400)
 * and the bold headings (700). Vite hashes font file names during the build, so
 * the hint is derived from the emitted bundle rather than a hard-coded path.
 */
export function preloadFirstPaintFonts(): Plugin {
  let base = '/';
  return {
    name: 'preload-first-paint-fonts',
    apply: 'build',
    configResolved(config) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const bundle = context.bundle;
        if (!bundle) return html;
        const links = ['vazirmatn-arabic-400-normal', 'vazirmatn-arabic-700-normal'].flatMap(
          (name) => {
            const file = Object.keys(bundle).find(
              (key) => key.endsWith('.woff2') && key.includes(name),
            );
            return file
              ? [
                  `    <link rel="preload" as="font" type="font/woff2" crossorigin href="${base}${file}" />`,
                ]
              : [];
          },
        );
        return links.length ? html.replace('</head>', `${links.join('\n')}\n  </head>`) : html;
      },
    },
  };
}

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { parseFrontMatter } = require('../src/content');
const { createBlogContext } = require('../src/site');
const { parseRootArguments } = require('../src/command-line');

async function buildImages(blog, { log = console.log } = {}) {
  const { contentDirectory } = blog;
  const outputPath = path.join(contentDirectory, 'image-manifest.json');
  const targetWidths = [640, 1280];
  const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  async function optimizeImage(collection, entryName, filename, sourceLabel) {
    const directory = path.join(contentDirectory, collection, entryName);
    const sourcePath = path.resolve(directory, filename);
    const directoryPrefix = `${path.resolve(directory)}${path.sep}`;
    if (sourcePath !== path.resolve(directory) && !sourcePath.startsWith(directoryPrefix)) {
      throw new Error(`Feature image escapes its content folder: ${sourceLabel}`);
    }
    const extension = path.extname(sourcePath).toLowerCase();
    if (!fs.existsSync(sourcePath) || !supportedExtensions.has(extension)) return null;

    const source = sharp(sourcePath);
    const sourceMetadata = await source.metadata();
    if (!sourceMetadata.width || !sourceMetadata.height) return null;

    const widths = [
      ...new Set(targetWidths.map((width) => Math.min(width, sourceMetadata.width))),
    ];
    const stem = path.basename(filename, extension);
    const sourceModified = fs.statSync(sourcePath).mtimeMs;
    const variants = [];

    for (const width of widths) {
      const filename = `${stem}-${width}.webp`;
      const variantPath = path.join(directory, filename);
      const current =
        fs.existsSync(variantPath) && fs.statSync(variantPath).mtimeMs >= sourceModified;

      if (!current) {
        await sharp(sourcePath)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 })
          .toFile(variantPath);
      }

      const variantMetadata = await sharp(variantPath).metadata();
      variants.push({
        file: filename,
        width: variantMetadata.width,
        height: variantMetadata.height,
      });
    }

    return {
      key: `${collection}/${entryName}/${filename}`.replaceAll(
        '\\',
        '/',
      ),
      value: {
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        variants,
      },
    };
  }

  async function optimizeMarkdownImages(collection, entry) {
    const directory = path.join(contentDirectory, collection, entry.name);
    const markdownPath = path.join(directory, 'index.md');
    if (!fs.existsSync(markdownPath)) return [];

    const { metadata } = parseFrontMatter(
      fs.readFileSync(markdownPath, 'utf8'),
      markdownPath,
    );
    return (
      await Promise.all(
        ['feature_image', 'card_image']
          .filter((field) => metadata[field])
          .map((field) =>
            optimizeImage(
              collection,
              entry.name,
              metadata[field],
              markdownPath,
            ),
          ),
      )
    ).filter(Boolean);
  }

  async function optimizeTagFeatureImage(entry) {
    const metadataPath = path.join(contentDirectory, 'tags', entry.name, 'index.json');
    if (!fs.existsSync(metadataPath)) return null;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (!metadata.featureImage || /^https?:\/\//i.test(metadata.featureImage)) {
      return null;
    }
    return optimizeImage(
      'tags',
      entry.name,
      metadata.featureImage,
      metadataPath,
    );
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;

    async function run() {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await worker(items[current]);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => run()),
    );
    return results;
  }

  async function main() {
    const jobs = [];
    for (const collection of ['posts', 'pages']) {
      const directory = path.join(contentDirectory, collection);
      if (!fs.existsSync(directory)) continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          jobs.push(() => optimizeMarkdownImages(collection, entry));
        }
      }
    }
    const tagsDirectory = path.join(contentDirectory, 'tags');
    if (fs.existsSync(tagsDirectory)) {
      for (const entry of fs.readdirSync(tagsDirectory, { withFileTypes: true })) {
        if (entry.isDirectory()) jobs.push(() => optimizeTagFeatureImage(entry));
      }
    }

    const images = (await mapLimit(jobs, 4, (job) => job()))
      .flat()
      .filter(Boolean);
    const manifest = Object.fromEntries(
      images.sort((a, b) => a.key.localeCompare(b.key)).map(({ key, value }) => [
        key,
        value,
      ]),
    );

    const previousManifest = fs.existsSync(outputPath)
      ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
      : {};
    const currentVariants = new Set(
      Object.entries(manifest).flatMap(([key, image]) =>
        image.variants.map(({ file }) =>
          path.resolve(contentDirectory, path.dirname(key), file),
        ),
      ),
    );
    let removed = 0;
    for (const [key, image] of Object.entries(previousManifest)) {
      for (const variant of image.variants || []) {
        const variantPath = path.resolve(
          contentDirectory,
          path.dirname(key),
          variant.file,
        );
        if (!variantPath.startsWith(`${contentDirectory}${path.sep}`)) {
          throw new Error(`Generated image escapes its content directory: ${variantPath}`);
        }
        if (!currentVariants.has(variantPath) && fs.existsSync(variantPath)) {
          // Only files recorded in the previous generated manifest are eligible.
          fs.unlinkSync(variantPath);
          removed += 1;
        }
      }
    }

    fs.mkdirSync(contentDirectory, { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    log(
      `Processed ${images.length} content images; removed ${removed} stale variants.`,
    );
  }

  await main();
}

if (require.main === module) {
  Promise.resolve().then(() => buildImages(createBlogContext({
    rootDirectory: parseRootArguments(process.argv.slice(2)),
  }))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildImages };

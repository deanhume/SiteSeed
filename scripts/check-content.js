const { validateContent } = require('../src/content-validator');
const { createBlogContext } = require('../src/site');
const { parseRootArguments } = require('../src/command-line');

function checkContent(blog, { log = console.log } = {}) {
  const issues = validateContent(blog.rootDirectory, { blog });
  const errors = issues.filter(({ severity }) => severity === 'error');
  const warnings = issues.filter(({ severity }) => severity === 'warning');

  for (const issue of issues) {
    const label = issue.severity === 'error' ? 'ERROR' : 'WARN ';
    log(`${label} ${issue.filePath}: ${issue.message}`);
  }

  log(
    `Checked content: ${errors.length} error(s), ${warnings.length} warning(s).`,
  );

  if (errors.length) throw new Error(`Content validation failed with ${errors.length} error(s).`);
}

if (require.main === module) {
  try {
    checkContent(createBlogContext({
      rootDirectory: parseRootArguments(process.argv.slice(2)),
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkContent };

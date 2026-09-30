function parseRootArguments(args) {
  if (!args.length) return undefined;
  if (args.length === 2 && args[0] === '--root' && args[1].trim() && !args[1].startsWith('--')) {
    return args[1];
  }
  throw new Error('Expected --root <blog-directory>, or no arguments to use SITESEED_ROOT/current directory.');
}

module.exports = { parseRootArguments };

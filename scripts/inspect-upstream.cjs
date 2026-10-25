// Read-only inspection of the user's installed distribution. Generated files are
// for understanding the shipped implementation, never a source of user settings.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const store = process.env.BUILD_TOOLS_STORE || "/Users/luluen/ai-project/CloudSaver/node_modules/.pnpm";
function existing(name, prefix) {
  const directory = fs.readdirSync(store).find(entry => entry.startsWith(prefix + "@"));
  if (!directory) throw new Error("Existing inspection tool unavailable: " + name);
  return require(path.join(store, directory, "node_modules", name));
}
const parser = existing("@babel/parser", "@babel+parser");
const generate = existing("@babel/generator", "@babel+generator").default;
const traverse = existing("@babel/traverse", "@babel+traverse").default;
const root = path.resolve(__dirname, "../upstream/nas-v0.8.3");
const outRoot = path.resolve(__dirname, "../.inspection");
function printable(node) { return generate(node, { jsescOption: { minimal: true } }).code; }
function literal(node) {
  return ["NumericLiteral", "StringLiteral"].includes(node.type) || node.type === "UnaryExpression" && literal(node.argument) || node.type === "BinaryExpression" && literal(node.left) && literal(node.right);
}
for (const relative of process.argv.slice(2)) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) throw new Error("Outside distribution");
  const source = fs.readFileSync(file, "utf8");
  const tree = parser.parse(source, { sourceType: "unambiguous" });
  const functions = tree.program.body.filter(node => node.type === "FunctionDeclaration" && /^a\d+_0x/.test(node.id.name));
  const aliases = new Map(functions.map(node => [node.id.name, node.id.name]));
  const rotation = tree.program.body.find(node => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.type === "FunctionExpression");
  let replacements = 0;
  if (functions.length && rotation) {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false } });
    const topAliases = tree.program.body.filter(node => node.type === "VariableDeclaration" && node.declarations.every(item => item.init?.type === "Identifier" && aliases.has(item.init.name)));
    vm.runInContext([...functions, ...topAliases, rotation].map(node => source.slice(node.start, node.end)).join("\n"), context, { timeout: 1500 });
    for (let pass = 0; pass < 8; pass++) {
      traverse(tree, { VariableDeclarator(p) { if (p.node.id.type === "Identifier" && p.node.init?.type === "Identifier" && aliases.has(p.node.init.name)) aliases.set(p.node.id.name, aliases.get(p.node.init.name)); } });
    }
    traverse(tree, { CallExpression(p) {
      const node = p.node;
      if (node.callee.type !== "Identifier" || !aliases.has(node.callee.name) || !node.arguments.length || !node.arguments.every(literal)) return;
      try {
        const value = vm.runInContext(aliases.get(node.callee.name) + "(" + node.arguments.map(printable).join(",") + ")", context, { timeout: 100 });
        if (typeof value === "string") { p.replaceWith({ type: "StringLiteral", value }); replacements++; }
      } catch { /* retain dynamic or non-decoder expressions */ }
    } });
  }
  const output = path.join(outRoot, relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, printable(tree));
  console.log(JSON.stringify({ file: relative, replacements, output }));
}

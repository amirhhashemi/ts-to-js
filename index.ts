import { describe, it } from "node:test";
import assert from "node:assert";

import ts from "typescript";
import MagicString from "magic-string";
import prettier from "prettier";

async function transformToJs(tsCode: string) {
  const ast = ts.createSourceFile(
    "filename.tsx",
    tsCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const code = new MagicString(tsCode);

  function walk(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) {
      code.overwrite(node.pos, node.end, "");
      return;
    }

    if (ts.isNamedImports(node)) {
      const newImports = node.elements.filter((e) => !e.isTypeOnly);
      code.overwrite(
        node.pos,
        node.end,
        "{" + newImports.map((i) => i.getText()).join(",") + "}",
      );
      return;
    }

    if (ts.isExportDeclaration(node) && node.isTypeOnly) {
      code.overwrite(node.pos, node.end, "");
      return;
    }

    if (ts.isNamedExports(node)) {
      const newExports = node.elements.filter((e) => !e.isTypeOnly);
      code.overwrite(
        node.pos,
        node.end,
        "{" + newExports.map((e) => e.getText()).join(", ") + "}",
      );
      return;
    }

    if (ts.isAsExpression(node)) {
      code.overwrite(node.pos, node.end, node.expression.getText());
      return;
    }

    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)
    ) {
      code.overwrite(node.pos, node.end, "");
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      if (node.type) {
        const colonToken = node
          .getChildren()
          .find((c) => c.kind === ts.SyntaxKind.ColonToken);
        if (colonToken) {
          code.overwrite(colonToken.pos, node.type.end, "");
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      if (node.typeParameters && node.typeParameters.length > 0) {
        const children = node.getChildren();
        const ltToken = children.find(
          (c) => c.kind === ts.SyntaxKind.LessThanToken,
        );
        const gtToken = children.find(
          (c) => c.kind === ts.SyntaxKind.GreaterThanToken,
        );
        if (ltToken && gtToken) {
          code.overwrite(ltToken.pos, gtToken.end, "");
        }
      }
      if (node.type) {
        const colonToken = node
          .getChildren()
          .find((c) => c.kind === ts.SyntaxKind.ColonToken);
        if (colonToken) {
          code.overwrite(colonToken.pos, node.type.end, "");
        }
      }
      node.parameters.forEach((p) => {
        if (p.type) {
          const colonToken = p
            .getChildren()
            .find((c) => c.kind === ts.SyntaxKind.ColonToken);
          if (colonToken) {
            code.overwrite(colonToken.pos, p.type.end, "");
          }
        }
      });
    }

    ts.forEachChild(node, walk);
  }

  walk(ast);

  return await prettier.format(code.toString(), { parser: "babel" });
}

function normalize(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

it("removes type-only import declarations", async () => {
  const input = `
    import type { Foo } from "./foo";
    import { Bar } from "./bar";
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("import type"));
  assert.ok(output.includes(`import { Bar }`));
});

it("removes type-only specifiers from named imports", async () => {
  const input = `
    import { type Foo, Bar } from "./foo";
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("type Foo"));
  assert.ok(output.includes("Bar"));
});

it("removes type-only export declarations", async () => {
  const input = `
    export type { Foo } from "./foo";
    export { Bar } from "./bar";
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("export type"));
  assert.ok(output.includes(`export { Bar }`));
});

it("removes type alias, interface, enum, and module declarations", async () => {
  const input = `
    type Foo = number;
    interface Bar { x: number; }
    enum Dirction { Up, Down }
    module Baz { export const qux = 1; }
    namespace Name {}
    const a = 123
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("type Foo"));
  assert.ok(!output.includes("interface Bar"));
  assert.ok(!output.includes("enum Direction"));
  assert.ok(!output.includes("module Baz"));
  assert.ok(!output.includes("namespace Name"));
  assert.ok(output.includes("const a = 123"));
});

it("removes variable type annotations", async () => {
  const input = `
    const a: number = 123;
    const b: number | string = 123;
    const c: {} = 123;
    const d: () => number = 123;
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes(": number"));
  assert.ok(!output.includes(": number | string"));
  assert.ok(!output.includes(": {}"));
  assert.ok(!output.includes(": () => number"));
  assert.ok(output.includes("const a = 123"));
  assert.ok(output.includes("const b = 123"));
  assert.ok(output.includes("const c = 123"));
  assert.ok(output.includes("const d = 123"));
});

it("removes function generics and type annotations", async () => {
  const input = `
    function foo<T>(a: number): string {
      return String(a);
    }
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("<T>"));
  assert.ok(!output.includes(": number"));
  assert.ok(!output.includes(": string"));
  assert.ok(output.includes("function foo(a) {"));
});

it('removes "as" expressions', async () => {
  const input = `
    const b = "123" as number;
  `;
  const output = await transformToJs(input);
  assert.ok(!output.includes("as number"));
  assert.ok(output.includes(`"123"`));
});

it("preserves colons in JSX attribute names", async () => {
  const input = `
    <div on:click={() => {}}></div>
  `;
  const output = await transformToJs(input);
  assert.ok(output.includes("on:click"));
});

describe("correclty transforms random examples from the docs", () => {
  it("sample 1", async () => {
    const input = `
      import { type Component } from "solid-js";
      const MyTsComponent: Component = () => {
        return (
          <div>
            <h1>This is a TypeScript component</h1>
          </div>
        );
      };
      export default MyTsComponent;
    `;
    const expected = `
      import {} from "solid-js";
      const MyTsComponent = () => {
        return (
          <div>
            <h1>This is a TypeScript component</h1>
          </div>
        );
      };
      export default MyTsComponent;
    `;
    const output = await transformToJs(input);
    assert.strictEqual(normalize(output), normalize(expected));
  });

  it("sample 2", async () => {
    const input = `
      import type { Signal, Accessor, Setter } from "solid-js";
      type Signal<T> = [get: Accessor<T>, set: Setter<T>];
    `;
    const expected = ``;
    const output = await transformToJs(input);
    assert.strictEqual(normalize(output), normalize(expected));
  });

  it("sample 3", async () => {
    const input = `
      const MyGenericComponent = <T extends unknown>(
        props: MyProps<T>
      ): JSX.Element => {};
      function MyGenericComponent<T>(props: MyProps<T>): JSX.Element {}
    `;
    const expected = `
      const MyGenericComponent = (props) => {};
      function MyGenericComponent(props) {}
    `;
    const output = await transformToJs(input);
    assert.ok(!output.includes("<T"));
    assert.ok(!output.includes(": MyProps"));
    assert.ok(!output.includes(": JSX.Element"));
    assert.strictEqual(normalize(output), normalize(expected));
  });

  it("sample 4", async () => {
    const input = `
      type User = Admin | OtherUser;
      const admin = createMemo(() => {
        const u = user();
        return u && u.type === "admin" ? u : undefined;
      });
      return <Show when={admin()}>{(a) => <AdminPanel user={a()} />}</Show>;
    `;
    const expected = `
      const admin = createMemo(() => {
        const u = user();
        return u && u.type === "admin" ? u : undefined;
      });
      return <Show when={admin()}>{(a) => <AdminPanel user={a()} />}</Show>;
    `;
    const output = await transformToJs(input);
    assert.ok(!output.includes("type User"));
    assert.strictEqual(normalize(output), normalize(expected));
  });

  it("sample 5", async () => {
    const input = `
      declare module "solid-js" {
        namespace JSX {
          interface ExplicitProperties {
            count: number;
            name: string;
          }
          interface ExplicitAttributes {
            count: number;
            name: string;
          }
          interface ExplicitBoolAttributes {
            disabled: boolean;
          }
        }
      }
      function Comp() {
        return (
          <>
            <Input prop:name={name()} prop:count={count()} />
            <my-web-component attr:name={name()} attr:count={count()} bool:disabled={true} />
          </>
        );
      }
    `;
    const expected = `
      function Comp() {
        return (
          <>
            <Input prop:name={name()} prop:count={count()} />
            <my-web-component attr:name={name()} attr:count={count()} bool:disabled={true} />
          </>
        );
      }
    `;
    const output = await transformToJs(input);
    assert.ok(!output.includes('declare module "solid-js"'));
    assert.strictEqual(normalize(output), normalize(expected));
  });
});

export function setupTestDom(): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- checking node vs browser environment
  if (typeof globalThis.document !== "undefined") return;

  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  class MockNode {
    readonly childNodes: MockNode[] = [];
    readonly namespaceURI = "http://www.w3.org/1999/xhtml";
    readonly nodeName = "DIV";
    readonly nodeType = 1;
    ownerDocument: unknown = null;
    parentNode: MockNode | null = null;
    readonly tagName = "DIV";
    textContent = "";
    addEventListener(_type: string, _listener: unknown): void {}
    appendChild<T extends MockNode>(child: T): T {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore<T extends MockNode>(newChild: T, refChild: MockNode | null): T {
      const index = refChild ? this.childNodes.indexOf(refChild) : -1;
      if (index !== -1) {
        this.childNodes.splice(index, 0, newChild);
      } else {
        this.childNodes.push(newChild);
      }
      newChild.parentNode = this;
      return newChild;
    }
    remove(): void {
      this.parentNode?.removeChild(this);
    }
    removeAttribute(_name: string): void {}
    removeChild<T extends MockNode>(child: T): T {
      const index = this.childNodes.indexOf(child);
      if (index !== -1) {
        child.parentNode = null;
        this.childNodes.splice(index, 1);
      }
      return child;
    }
    removeEventListener(_type: string, _listener: unknown): void {}
    setAttribute(_name: string, _value: string): void {}
  }

  class MockIFrame extends MockNode {}

  const mockDoc = {
    activeElement: null as unknown,
    addEventListener(_type: string, _listener: unknown): void {},
    body: new MockNode(),
    createElement(_tag: string): MockNode {
      const node = new MockNode();
      node.ownerDocument = mockDoc;
      return node;
    },
    createElementNS(_ns: string, _tag: string): MockNode {
      const node = new MockNode();
      node.ownerDocument = mockDoc;
      return node;
    },
    createTextNode(text: string): MockNode {
      const node = new MockNode();
      node.ownerDocument = mockDoc;
      node.textContent = text;
      return node;
    },
    defaultView: null as unknown,
    removeEventListener(_type: string, _listener: unknown): void {},
  };
  mockDoc.body.ownerDocument = mockDoc;

  const mockWindow = {
    addEventListener(_type: string, _listener: unknown): void {},
    document: mockDoc,
    Element: MockNode,
    HTMLDivElement: MockNode,
    HTMLElement: MockNode,
    HTMLIFrameElement: MockIFrame,
    Node: MockNode,
    removeEventListener(_type: string, _listener: unknown): void {},
  };
  mockDoc.defaultView = mockWindow;

  const globals = globalThis as Record<string, unknown>;
  globals.document = mockDoc;
  globals.window = mockWindow;
  globals.Node = MockNode;
  globals.Element = MockNode;
  globals.HTMLElement = MockNode;
  globals.HTMLDivElement = MockNode;
  globals.HTMLIFrameElement = MockIFrame;
  globals.Text = MockNode;
}

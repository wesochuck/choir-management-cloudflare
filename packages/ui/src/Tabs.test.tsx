import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

describe("Tabs primitive", () => {
  it("renders semantic tablist, tabs, and active tabpanel with APG attributes", () => {
    const html = renderToString(
      <Tabs onValueChange={vi.fn()} value="tab-1">
        <TabsList aria-label="Test sections">
          <TabsTrigger value="tab-1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab-2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab-1">Content 1</TabsContent>
        <TabsContent value="tab-2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Test sections"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Content 1");
    expect(html).not.toContain("Content 2");
  });

  it("links tab trigger and panel with corresponding id and aria attributes", () => {
    const html = renderToString(
      <Tabs onValueChange={vi.fn()} value="dues">
        <TabsList aria-label="Dues views">
          <TabsTrigger aria-controls="dues-panel" id="dues-tab" value="dues">
            Dues
          </TabsTrigger>
        </TabsList>
        <TabsContent aria-labelledby="dues-tab" id="dues-panel" value="dues">
          Dues Panel Content
        </TabsContent>
      </Tabs>,
    );

    expect(html).toContain('id="dues-tab"');
    expect(html).toContain('aria-controls="dues-panel"');
    expect(html).toContain('id="dues-panel"');
    expect(html).toContain('aria-labelledby="dues-tab"');
  });
});

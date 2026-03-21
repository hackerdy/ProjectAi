import {
  AlignmentType,
  Document,
  Footer,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";

// ── Style configuration ───────────────────────────────────────────────────────

interface DocStyle {
  fontName: string;
  bodySizeHp: number;       // half-points  (pt × 2)
  h1SizeHp: number;
  h2SizeHp: number;
  h3SizeHp: number;
  lineSpacing: number;      // twentieths of a point  (240 = single, 480 = double)
  paraSpacingAfter: number; // twips after each body paragraph
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  firstLineIndent: number;  // first-line indent for body paragraphs (twips)
}

const hp  = (pt: number) => pt * 2;          // points  → half-points
const lsp = (n: number)  => Math.round(n * 240); // line multiplier → twentieths

const BASE: DocStyle = {
  fontName:        "Times New Roman",
  bodySizeHp:      hp(12),
  h1SizeHp:        hp(20),
  h2SizeHp:        hp(14),
  h3SizeHp:        hp(12),
  lineSpacing:     lsp(2),         // double-spaced
  paraSpacingAfter: 0,
  marginTop:       convertInchesToTwip(1),
  marginBottom:    convertInchesToTwip(1),
  marginLeft:      convertInchesToTwip(1),
  marginRight:     convertInchesToTwip(1),
  firstLineIndent: convertInchesToTwip(0.5),
};

// Citation-style overrides (applied first)
const CITATION_OVERRIDES: Record<string, Partial<DocStyle>> = {
  IEEE: {
    bodySizeHp:       hp(10),
    h2SizeHp:         hp(11),
    h3SizeHp:         hp(10),
    lineSpacing:      lsp(1),
    paraSpacingAfter: 160,
    firstLineIndent:  0,
  },
  APA: {
    lineSpacing:     lsp(2),
    firstLineIndent: convertInchesToTwip(0.5),
  },
  MLA: {
    lineSpacing:     lsp(2),
    firstLineIndent: convertInchesToTwip(0.5),
  },
  CHICAGO: {
    lineSpacing:     lsp(2),
    firstLineIndent: convertInchesToTwip(0.5),
  },
  VANCOUVER: {
    lineSpacing:     lsp(2),
    firstLineIndent: 0,
  },
};

// style_id overrides (applied second, highest priority)
const STYLE_ID_OVERRIDES: Record<string, Partial<DocStyle>> = {
  computer_science_thesis: {
    bodySizeHp:      hp(11),
    lineSpacing:     lsp(1.5),
    firstLineIndent: 0,
    paraSpacingAfter: 200,
  },
  engineering_report: {
    bodySizeHp:      hp(11),
    lineSpacing:     lsp(1.5),
    firstLineIndent: 0,
    paraSpacingAfter: 200,
  },
  harvard_business: {
    lineSpacing:     lsp(2),
    marginLeft:      convertInchesToTwip(1.25),
    firstLineIndent: convertInchesToTwip(0.5),
  },
  research_paper: {
    lineSpacing:     lsp(2),
    firstLineIndent: convertInchesToTwip(0.5),
  },
};

function resolveStyle(styleId: string, citationStyle: string): DocStyle {
  const sid    = styleId.toLowerCase().replace(/[-\s]+/g, "_");
  const citKey = citationStyle.toUpperCase().split(/[/\s,]/)[0].trim();
  return {
    ...BASE,
    ...(CITATION_OVERRIDES[citKey]  ?? {}),
    ...(STYLE_ID_OVERRIDES[sid]     ?? {}),
  };
}

// ── Inline markdown parser ────────────────────────────────────────────────────
// Handles **bold**, *italic*, `code` and plain text segments within a line.

function parseInline(
  text: string,
  font: string,
  size: number,
  extra: Partial<{ bold: boolean; italics: boolean; color: string }> = {}
): TextRun[] {
  const runs: TextRun[] = [];
  // Captures: **bold** | *italic* | `code` | plain text
  const re = /(\*\*([^*\n]+?)\*\*)|(\*([^*\n]+?)\*)|(`([^`\n]+?)`)|([^*`]+)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      // **bold**
      runs.push(new TextRun({ text: m[2], bold: true, font, size, ...extra }));
    } else if (m[3] !== undefined) {
      // *italic*
      runs.push(new TextRun({ text: m[4], italics: true, font, size, ...extra }));
    } else if (m[5] !== undefined) {
      // `code`
      runs.push(new TextRun({ text: m[6], font: "Courier New", size: size - 2 }));
    } else if (m[7] !== undefined && m[7].trim()) {
      runs.push(new TextRun({ text: m[7], font, size, ...extra }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text: text.trim(), font, size, ...extra }));
  }

  return runs;
}

// ── Markdown → Paragraph list ─────────────────────────────────────────────────

function markdownToParagraphs(markdown: string, s: DocStyle): Paragraph[] {
  const out: Paragraph[]  = [];
  const lines             = markdown.split("\n");
  const pending: string[] = [];   // accumulates contiguous body-text lines
  let   h2Count           = 0;    // track H2 count to control page breaks

  const flush = () => {
    const joined = pending.join(" ").replace(/\s+/g, " ").trim();
    pending.length = 0;
    if (!joined) return;

    out.push(
      new Paragraph({
        children: parseInline(joined, s.fontName, s.bodySizeHp),
        spacing: {
          line:  s.lineSpacing,
          after: s.paraSpacingAfter,
        },
        indent: { firstLine: s.firstLineIndent },
      })
    );
  };

  for (const raw of lines) {
    const t = raw.trim();

    // ─ Blank line or horizontal rule → paragraph break
    if (t === "" || t === "---") {
      flush();
      continue;
    }

    // ─ Skip auto-generated footer and "Review Metadata" heading
    if (/^\*Generated using ProjectAi/i.test(t)) continue;
    if (/^###\s+Review Metadata/i.test(t))        continue;

    // ── H4: #### ─────────────────────────────────────────────────────────────
    if (t.startsWith("#### ")) {
      flush();
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text:   t.slice(5),
              bold:   true,
              font:   s.fontName,
              size:   s.bodySizeHp,
              underline: {},
            }),
          ],
          spacing: { before: 160, after: 80, line: s.lineSpacing },
        })
      );
      continue;
    }

    // ── H3: ### ──────────────────────────────────────────────────────────────
    if (t.startsWith("### ")) {
      flush();
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text:    t.slice(4),
              bold:    true,
              italics: true,
              font:    s.fontName,
              size:    s.h3SizeHp,
            }),
          ],
          spacing: { before: 280, after: 120, line: s.lineSpacing },
        })
      );
      continue;
    }

    // ── H2: ## ───────────────────────────────────────────────────────────────
    if (t.startsWith("## ")) {
      flush();
      h2Count++;
      const headingText = t.slice(3);
      // Every H2 after the first (Abstract) starts on a fresh page
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text:  headingText,
              bold:  true,
              font:  s.fontName,
              size:  s.h2SizeHp,
            }),
          ],
          spacing:        { before: 480, after: 240, line: s.lineSpacing },
          pageBreakBefore: h2Count > 1,
        })
      );
      continue;
    }

    // ── H1: # (title already on title page — skip) ───────────────────────────
    if (t.startsWith("# ")) {
      flush();
      continue;
    }

    // ── Unordered list: - item  /  * item ────────────────────────────────────
    if (/^[-*] /.test(t)) {
      flush();
      out.push(
        new Paragraph({
          bullet:   { level: 0 },
          children: parseInline(t.slice(2), s.fontName, s.bodySizeHp),
          spacing:  { line: s.lineSpacing, after: 60 },
        })
      );
      continue;
    }

    // ── Ordered list: 1. item ────────────────────────────────────────────────
    if (/^\d+\.\s/.test(t)) {
      flush();
      const text = t.replace(/^\d+\.\s/, "");
      out.push(
        new Paragraph({
          numbering: { reference: "doc-numbering", level: 0 },
          children:  parseInline(text, s.fontName, s.bodySizeHp),
          spacing:   { line: s.lineSpacing, after: 60 },
        })
      );
      continue;
    }

    // ── Blockquote: > text ───────────────────────────────────────────────────
    if (t.startsWith("> ")) {
      flush();
      out.push(
        new Paragraph({
          children: parseInline(t.slice(2), s.fontName, s.bodySizeHp - 2, { italics: true, color: "444444" }),
          indent:   { left: convertInchesToTwip(0.5) },
          spacing:  { line: lsp(1.15), after: 120 },
        })
      );
      continue;
    }

    // ── Review metadata dash lines: - Key: Value ─────────────────────────────
    if (/^- [\w\s]+:/.test(t)) {
      flush();
      out.push(
        new Paragraph({
          children: parseInline(t.slice(2), s.fontName, s.bodySizeHp - 2, { color: "555555" }),
          spacing:  { after: 60 },
        })
      );
      continue;
    }

    // ── Regular body text — accumulate ───────────────────────────────────────
    pending.push(t);
  }

  flush();
  return out;
}

// ── Title page ────────────────────────────────────────────────────────────────

function buildTitlePage(
  title: string,
  topic: string,
  styleId: string,
  citationStyle: string,
  s: DocStyle
): Paragraph[] {
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const displayStyle = styleId
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const paragraphs: Paragraph[] = [

    // Top padding
    new Paragraph({ text: "", spacing: { before: convertInchesToTwip(1.2) } }),

    // Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text:  title,
          bold:  true,
          font:  s.fontName,
          size:  hp(22),
        }),
      ],
      spacing: { after: 480 },
    }),
  ];

  // Sub-topic (when different from title)
  if (topic && topic.trim().toLowerCase() !== title.trim().toLowerCase()) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text:    topic,
            italics: true,
            font:    s.fontName,
            size:    s.bodySizeHp,
          }),
        ],
        spacing: { after: 600 },
      })
    );
  }

  paragraphs.push(
    // Spacer
    new Paragraph({ text: "", spacing: { before: convertInchesToTwip(0.8) } }),

    // Style Profile
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Style Profile:  ", font: s.fontName, size: s.bodySizeHp }),
        new TextRun({ text: displayStyle, bold: true, font: s.fontName, size: s.bodySizeHp }),
      ],
      spacing: { after: 120 },
    }),

    // Citation format
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Citation Format:  ", font: s.fontName, size: s.bodySizeHp }),
        new TextRun({ text: citationStyle, bold: true, font: s.fontName, size: s.bodySizeHp }),
      ],
      spacing: { after: 120 },
    }),

    // Date
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: date, font: s.fontName, size: s.bodySizeHp }),
      ],
      spacing: { after: 240 },
    }),

    // Thin separator
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "────────────────────", font: s.fontName, size: s.bodySizeHp, color: "999999" }),
      ],
      spacing: { after: 120 },
    }),

    // Branding
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Generated by ", font: s.fontName, size: s.bodySizeHp - 2, color: "777777" }),
        new TextRun({ text: "ProjectAi", bold: true, font: s.fontName, size: s.bodySizeHp - 2, color: "1D4ED8" }),
        new TextRun({ text: " — Autonomous Academic Research Engine", font: s.fontName, size: s.bodySizeHp - 2, color: "777777" }),
      ],
    })
  );

  return paragraphs;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DocxInput {
  title: string;
  topic: string;
  styleId: string;
  citationStyle: string;
  finalDocument: string;   // Full markdown from the AI pipeline
}

export async function generateDocx(input: DocxInput): Promise<Buffer> {
  const { title, topic, styleId, citationStyle, finalDocument } = input;
  const s = resolveStyle(styleId, citationStyle);

  const titlePageParagraphs = buildTitlePage(title, topic, styleId, citationStyle, s);
  const bodyParagraphs      = markdownToParagraphs(finalDocument, s);

  const doc = new Document({
    // ── Numbered list config ──────────────────────────────────────────────────
    numbering: {
      config: [
        {
          reference: "doc-numbering",
          levels: [
            {
              level:     0,
              format:    LevelFormat.DECIMAL,
              text:      "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left:    convertInchesToTwip(0.5),
                    hanging: convertInchesToTwip(0.25),
                  },
                },
              },
            },
          ],
        },
      ],
    },

    sections: [
      {
        properties: {
          page: {
            margin: {
              top:    s.marginTop,
              bottom: s.marginBottom,
              left:   s.marginLeft,
              right:  s.marginRight,
            },
          },
        },

        // ── Page-number footer ──────────────────────────────────────────────
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font:     s.fontName,
                    size:     s.bodySizeHp - 4,
                    color:    "777777",
                  }),
                ],
              }),
            ],
          }),
        },

        children: [
          ...titlePageParagraphs,
          // Hard page break → body begins on its own page
          new Paragraph({ children: [new PageBreak()] }),
          ...bodyParagraphs,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

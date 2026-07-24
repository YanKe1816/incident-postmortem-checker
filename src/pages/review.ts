const SUPPORT_EMAIL = "sidcraigau@gmail.com";
const EFFECTIVE_DATE = "July 24, 2026";

type PageLink = { href: string; label: string };
type PageSection = { title: string; paragraphs?: string[]; bullets?: string[] };
type PageConfig = {
  path: string;
  title: string;
  description: string;
  eyebrow?: string;
  intro: string;
  sections: PageSection[];
};

const navLinks: PageLink[] = [
  { href: "/", label: "Home" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/support", label: "Support" }
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNav(currentPath: string): string {
  return navLinks
    .map((link) => {
      const active = link.href === currentPath ? ' aria-current="page"' : "";
      return `<a href="${escapeHtml(link.href)}"${active}>${escapeHtml(link.label)}</a>`;
    })
    .join("");
}

function renderSection(section: PageSection): string {
  const paragraphs = (section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const bullets = section.bullets ? `<ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  return `<section><h2>${escapeHtml(section.title)}</h2>${paragraphs}${bullets}</section>`;
}

function renderPage(config: PageConfig): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.title)} | Incident Postmortem Checker</title>
  <meta name="description" content="${escapeHtml(config.description)}">
  <style>
    :root { color-scheme: light; --ink: #172026; --muted: #52616b; --line: #d9ded8; --paper: #fbfbf8; --accent: #1f6f68; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); background: var(--paper); }
    header, main, footer { width: min(960px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 24px 0 10px; border-bottom: 1px solid var(--line); }
    nav { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; }
    nav a { color: var(--accent); font-weight: 650; text-decoration: none; }
    nav a[aria-current="page"] { color: var(--ink); }
    main { padding: 42px 0 48px; }
    .eyebrow { color: var(--accent); font-size: 0.88rem; font-weight: 700; margin: 0 0 10px; text-transform: uppercase; }
    h1 { font-size: clamp(2rem, 4vw, 3.5rem); line-height: 1.05; margin: 0 0 16px; letter-spacing: 0; }
    h2 { font-size: 1.1rem; margin: 0 0 10px; }
    p, li { color: var(--muted); line-height: 1.6; }
    .intro { max-width: 760px; font-size: 1.12rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-top: 30px; }
    section { border-top: 1px solid var(--line); padding-top: 18px; }
    ul { padding-left: 20px; }
    footer { border-top: 1px solid var(--line); padding: 20px 0 34px; color: var(--muted); font-size: 0.94rem; }
  </style>
</head>
<body>
  <header><nav aria-label="Primary">${renderNav(config.path)}</nav></header>
  <main>
    ${config.eyebrow ? `<p class="eyebrow">${escapeHtml(config.eyebrow)}</p>` : ""}
    <h1>${escapeHtml(config.title)}</h1>
    <p class="intro">${escapeHtml(config.intro)}</p>
    <div class="grid">${config.sections.map(renderSection).join("")}</div>
  </main>
  <footer>Support Email: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></footer>
</body>
</html>`;
}

export function renderHomePage(): string {
  return renderPage({
    path: "/",
    title: "Incident Postmortem Checker",
    description: "Read-only MCP service for extracting incident timelines, follow-up actions, and postmortem completeness checks from supplied text.",
    eyebrow: "Read-only incident review support",
    intro: "Extract incident timelines and follow-up actions, and check postmortem completeness using only the text you provide.",
    sections: [
      {
        title: "Incident Timeline Extraction",
        paragraphs: ["Extract explicitly stated incident events and impact statements, then return the events in chronological order."]
      },
      {
        title: "Follow-up Action Extraction",
        paragraphs: ["Extract explicitly stated follow-up actions, owners, deadlines, and supporting evidence."]
      },
      {
        title: "Postmortem Completeness Check",
        paragraphs: ["Check supplied postmortem material against user-provided requirements and identify present and missing items."]
      },
      {
        title: "Boundaries",
        paragraphs: ["The service analyzes only the text supplied in the request. It does not access incident management systems, infer unstated facts, assign blame, approve postmortems, assign tasks, contact people, update tickets, or perform remediation."]
      },
      {
        title: "Data Handling Summary",
        paragraphs: ["The service processes incident records or postmortem text that users submit in a request only to generate the result for that request. See the Privacy Policy for more detail."]
      }
    ]
  });
}

export function renderPrivacyPage(): string {
  return renderPage({
    path: "/privacy",
    title: "Privacy Policy",
    description: "Privacy Policy for Incident Postmortem Checker.",
    intro: `Effective Date: ${EFFECTIVE_DATE}. This policy describes how Incident Postmortem Checker handles text submitted for incident review support.`,
    sections: [
      {
        title: "Information Processed",
        paragraphs: ["The service processes user-submitted incident records, postmortem text, checklist items, optional source labels, and related text supplied in a request."],
        bullets: ["Inputs may include events, impact statements, root cause descriptions, action items, owners, and due dates."]
      },
      {
        title: "Use of Data",
        paragraphs: ["Submitted text is used to return structured analysis for the current request. The service itself does not actively access external systems or accounts and does not sell user-submitted data."]
      },
      {
        title: "Operational Boundaries",
        paragraphs: ["The service does not directly contact people, assign tasks, or update external systems. Underlying hosting and transport providers may process technical request data needed to deliver the service."]
      },
      {
        title: "Sensitive Information",
        paragraphs: ["Do not submit passwords, API keys, access tokens, or unrelated sensitive information."]
      },
      {
        title: "Contact",
        paragraphs: [`Questions can be sent to ${SUPPORT_EMAIL}.`]
      }
    ]
  });
}

export function renderTermsPage(): string {
  return renderPage({
    path: "/terms",
    title: "Terms of Service",
    description: "Terms of Service for Incident Postmortem Checker.",
    intro: `Effective Date: ${EFFECTIVE_DATE}. These terms describe acceptable use and service boundaries for Incident Postmortem Checker.`,
    sections: [
      {
        title: "Service Purpose",
        paragraphs: ["The service extracts and checks explicitly stated information from user-provided materials. Outputs are assistive structured results."]
      },
      {
        title: "User Responsibility",
        paragraphs: ["Users are responsible for reviewing outputs and making final decisions. The service does not replace formal incident management, engineering judgment, legal judgment, or organizational approval."]
      },
      {
        title: "Acceptable Use",
        paragraphs: ["Users must not submit content they are not authorized to process or use the service for unlawful, destructive, or unauthorized activity."]
      },
      {
        title: "Availability and Accuracy",
        paragraphs: ["The service is provided as is. It does not guarantee that submitted material is true or complete, and service capabilities may change or pause."]
      },
      {
        title: "Support",
        paragraphs: [`Support requests can be sent to ${SUPPORT_EMAIL}.`]
      }
    ]
  });
}

export function renderSupportPage(): string {
  return renderPage({
    path: "/support",
    title: "Support",
    description: "Support information for Incident Postmortem Checker.",
    intro: `Support Email: ${SUPPORT_EMAIL}`,
    sections: [
      {
        title: "What to Include",
        bullets: ["A short description of the issue", "When the issue occurred", "The tool name used", "A non-sensitive input example", "The actual result and expected result"]
      },
      {
        title: "Available Tools",
        bullets: ["extract_incident_timeline", "extract_postmortem_actions", "check_postmortem_completeness"]
      },
      {
        title: "Do Not Send Sensitive Data",
        paragraphs: ["Do not send passwords, API keys, access tokens, or unrelated sensitive information."]
      }
    ]
  });
}

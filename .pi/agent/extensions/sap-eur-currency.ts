import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  // We run this immediately in the factory function so it executes as early as possible
  try {
    let patched = false;

    // 1. Patch pi-coding-agent footer.js
    const footerPath = "/Users/I753239/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js";
    if (fs.existsSync(footerPath)) {
      let content = fs.readFileSync(footerPath, "utf8");
      if (content.includes('const costStr = `$${usageTotals.cost.toFixed(3)}')) {
        content = content.replace(
          'const costStr = `$${usageTotals.cost.toFixed(3)}',
          'const costStr = `€${usageTotals.cost.toFixed(3)}'
        );
        fs.writeFileSync(footerPath, content, "utf8");
        patched = true;
      }
    }

    // 2. Patch pi-coding-agent template.js (HTML exports)
    const templatePath = "/Users/I753239/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.js";
    if (fs.existsSync(templatePath)) {
      let content = fs.readFileSync(templatePath, "utf8");
      if (content.includes('class="info-value">$${totalCost.toFixed(3)}</span>')) {
        content = content.replace(
          'class="info-value">$${totalCost.toFixed(3)}</span>',
          'class="info-value">€${totalCost.toFixed(3)}</span>'
        );
        fs.writeFileSync(templatePath, content, "utf8");
        patched = true;
      }
    }

    // 3. Patch pi-coding-agent interactive-mode.js
    const interactiveModePath = "/Users/I753239/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
    if (fs.existsSync(interactiveModePath)) {
      let content = fs.readFileSync(interactiveModePath, "utf8");
      let changed = false;
      if (content.includes('const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";')) {
        content = content.replace(
          'const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";',
          'const cost = miss.missedCost >= 0.01 ? ` (~€${miss.missedCost.toFixed(2)})` : "";'
        );
        changed = true;
      }
      if (content.includes('info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(3)}`;')) {
        content = content.replace(
          'info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(3)}`;',
          'info += `${theme.fg("dim", "Total:")} €${stats.cost.toFixed(3)}`;'
        );
        changed = true;
      }
      if (content.includes('info += `\\n  ${theme.fg("dim", `${entry.key}:`)} $${entry.cost.toFixed(3)}')) {
        content = content.replace(
          'info += `\\n  ${theme.fg("dim", `${entry.key}:`)} $${entry.cost.toFixed(3)}',
          'info += `\\n  ${theme.fg("dim", `${entry.key}:`)} €${entry.cost.toFixed(3)}'
        );
        changed = true;
      }
      if (content.includes('? `\\n${theme.fg("dim", "Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)}')) {
        content = content.replace(
          '? `\\n${theme.fg("dim", "Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)}',
          '? `\\n${theme.fg("dim", "Cache Re-billed:")} €${cacheWaste.missedCost.toFixed(3)}'
        );
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(interactiveModePath, content, "utf8");
        patched = true;
      }
    }

    // 4. Patch context-mode statusline.mjs
    const statuslinePath = "/Users/I753239/.pi/agent/npm/node_modules/context-mode/bin/statusline.mjs";
    if (fs.existsSync(statuslinePath)) {
      let content = fs.readFileSync(statuslinePath, "utf8");
      let changed = false;
      if (content.includes('return `$${safe.toFixed(0)}`;')) {
        content = content.replace('return `$${safe.toFixed(0)}`;', 'return `€${safe.toFixed(0)}`;');
        changed = true;
      }
      if (content.includes('return `$${safe.toFixed(2)}`;')) {
        content = content.replace('return `$${safe.toFixed(2)}`;', 'return `€${safe.toFixed(2)}`;');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(statuslinePath, content, "utf8");
        patched = true;
      }
    }

    // 5. Patch pi-observability footer cost segment
    const obsSegmentsPath = "/Users/I753239/.pi/agent/npm/node_modules/pi-observability/extensions/lib/footer-engine/segments.ts";
    if (fs.existsSync(obsSegmentsPath)) {
      let content = fs.readFileSync(obsSegmentsPath, "utf8");
      if (content.includes('return theme.fg("dim", `$${totalCost.toFixed(4)}`);')) {
        content = content.replace(
          'return theme.fg("dim", `$${totalCost.toFixed(4)}`);',
          'return theme.fg("dim", `€${totalCost.toFixed(4)}`);'
        );
        fs.writeFileSync(obsSegmentsPath, content, "utf8");
        patched = true;
      }
    }

    // 6. Patch pi-observability observability.ts dashboard
    const obsMainPath = "/Users/I753239/.pi/agent/npm/node_modules/pi-observability/extensions/observability.ts";
    if (fs.existsSync(obsMainPath)) {
      let content = fs.readFileSync(obsMainPath, "utf8");
      let changed = false;
      if (content.includes('`Cost: $${totalCost.toFixed(6)}`')) {
        content = content.replace('`Cost: $${totalCost.toFixed(6)}`', '`Cost: €${totalCost.toFixed(6)}`');
        changed = true;
      }
      if (content.includes('`$${t.cost.toFixed(2)}`')) {
        content = content.replace('`$${t.cost.toFixed(2)}`', '`€${t.cost.toFixed(2)}`');
        changed = true;
      }
      if (content.includes('`$${h.cost.toFixed(2)}`')) {
        content = content.replace('`$${h.cost.toFixed(2)}`', '`€${h.cost.toFixed(2)}`');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(obsMainPath, content, "utf8");
        patched = true;
      }
    }

    // Hook session_start to notify the user if we just healed from an upgrade
    if (patched) {
      pi.on("session_start", async (_event, ctx) => {
        ctx.ui.notify("Healed currency symbols from USD ($) to EUR (€) after upgrade!", "info");
      });
    }
  } catch (error) {
    // Fail silently so startup is never blocked
  }
}

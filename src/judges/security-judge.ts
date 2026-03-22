import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SubJudgeCheck } from '../schemas/reports.js';

const execFileAsync = promisify(execFile);

interface SecurityViolation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

const SECURITY_RULES: Array<{
  name: string;
  pattern: RegExp;
  fileExts?: string[];
  description: string;
}> = [
  {
    name: 'no-eval',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    description: 'eval() or new Function() — code injection risk',
  },
  {
    name: 'no-hardcoded-secrets',
    pattern: /(?:password|secret|api_?key|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    description: 'Hardcoded secret or API key',
  },
  {
    name: 'no-sql-concat',
    pattern: /(?:query|execute|sql)\s*\(\s*[`'"].*\$\{|(?:query|execute|sql)\s*\(\s*['"].*\+/i,
    fileExts: ['.ts', '.js', '.mts', '.mjs'],
    description: 'SQL string concatenation — injection risk',
  },
  {
    name: 'no-innerhtml',
    pattern: /\.innerHTML\s*=/,
    fileExts: ['.ts', '.tsx', '.js', '.jsx'],
    description: 'innerHTML assignment in JS/TS — XSS risk (use textContent or DOM APIs)',
  },
  {
    name: 'no-insecure-http',
    pattern: /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    description: 'Insecure HTTP URL (use HTTPS)',
  },
  {
    name: 'no-exec-with-input',
    pattern: /(?:exec|execSync|spawn)\s*\([^)]*(?:req\.|input|param|arg|user)/i,
    fileExts: ['.ts', '.js', '.mts', '.mjs'],
    description: 'Command execution with user input — injection risk',
  },
  {
    name: 'no-cors-wildcard',
    pattern: /origin:\s*['"]?\*['"]?|Access-Control-Allow-Origin['"]\s*,\s*['"]\*/,
    fileExts: ['.ts', '.js', '.mts', '.mjs'],
    description: 'Explicit CORS wildcard origin: "*" — use specific origins in production',
  },
  {
    name: 'no-express-json-no-limit',
    pattern: /express\.json\s*\(\s*\)/,
    fileExts: ['.ts', '.js', '.mts', '.mjs'],
    description: 'express.json() without body size limit — DoS risk. Use express.json({ limit: "1mb" })',
  },
  {
    name: 'no-dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML/,
    fileExts: ['.tsx', '.jsx'],
    description: 'dangerouslySetInnerHTML — XSS risk',
  },
];

/**
 * Scan project files for common security anti-patterns.
 * Returns a SubJudgeCheck with pass/fail and details on violations found.
 */
export async function runSecurityCheck(projectDir: string): Promise<SubJudgeCheck> {
  // Get list of tracked source files
  let files: string[];
  try {
    const { stdout } = await execFileAsync(
      'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: projectDir, timeout: 10_000 },
    );
    files = stdout.trim().split('\n').filter(Boolean);
  } catch {
    return { name: 'security', passed: true, message: 'skipped: not a git repo or no files' };
  }

  // Filter to source files only
  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.html', '.sql']);
  const sourceFiles = files.filter(f => sourceExts.has(extname(f)));

  if (sourceFiles.length === 0) {
    return { name: 'security', passed: true, message: 'skipped: no source files' };
  }

  const violations: SecurityViolation[] = [];

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = await readFile(join(projectDir, file), 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (const rule of SECURITY_RULES) {
      // Skip rules that don't apply to this file type
      if (rule.fileExts && !rule.fileExts.includes(extname(file))) continue;

      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          violations.push({
            file,
            line: i + 1,
            rule: rule.name,
            snippet: lines[i].trim().slice(0, 120),
          });
        }
      }
    }
  }

  // Run npm audit if package-lock.json exists (checks for known vulnerable deps)
  try {
    await stat(join(projectDir, 'package-lock.json'));
    try {
      await execFileAsync('npm', ['audit', '--audit-level=high', '--json'], {
        cwd: projectDir,
        timeout: 30_000,
      });
    } catch (err: unknown) {
      const auditErr = err as { stdout?: string };
      if (auditErr.stdout) {
        try {
          const audit = JSON.parse(auditErr.stdout);
          const highOrCritical = (audit.metadata?.vulnerabilities?.high ?? 0) + (audit.metadata?.vulnerabilities?.critical ?? 0);
          if (highOrCritical > 0) {
            violations.push({
              file: 'package-lock.json',
              line: 1,
              rule: 'npm-audit',
              snippet: `${highOrCritical} high/critical vulnerability(ies) in dependencies`,
            });
          }
        } catch {
          // Couldn't parse audit output — skip
        }
      }
    }
  } catch {
    // No package-lock.json — skip audit
  }

  if (violations.length === 0) {
    return { name: 'security', passed: true };
  }

  const details = violations
    .map(v => `${v.file}:${v.line} [${v.rule}] ${v.snippet}`)
    .join('\n');

  return {
    name: 'security',
    passed: false,
    message: `${violations.length} security violation(s) found`,
    details,
  };
}

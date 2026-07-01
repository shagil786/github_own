export type SecretIssue = {
  id: string;
  label: string;
  reason: string;
};

type SecretPattern = {
  id: string;
  label: string;
  reason: string;
  regex: RegExp;
};

const CODE_FILE_REGEX = /\.(?:[cm]?[jt]sx?)$/i;
const AWS_SECRET_ASSIGNMENT_REGEX = /(?:^|[\s,{])["']?(AWS_SECRET_ACCESS_KEY)["']?\s*[:=]\s*(.+)$/i;
const JWT_SECRET_ASSIGNMENT_REGEX = /(?:^|[\s,{])["']?(JWT(?:_AUTH)?_SECRET)["']?\s*[:=]\s*(.+)$/i;
const GENERIC_SECRET_KEYWORD_REGEX =
  /(?:^|[\s,{])["']?(api[_-]?key|apiKey|secret[_-]?key|secretKey|access[_-]?token|accessToken|auth[_-]?token|authToken|client[_-]?secret|clientSecret|password)["']?\s*[:=]\s*(.+)$/i;
const QUOTED_VALUE_REGEX = /^(['"`])([\s\S]*?)\1/;
const SECRET_VALUE_CHAR_REGEX = /^[A-Za-z0-9_.~+/=-]+$/;
const CODE_REFERENCE_REGEX = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const CODE_IDENTIFIER_REGEX = /^[A-Za-z_$][\w$]*$/;

type AssignmentValue = {
  value: string;
  quoted: boolean;
};

type SecretAssignmentRule = {
  id: string;
  label: string;
  reason: string;
  regex: RegExp;
  minLength: number;
};

const SECRET_ASSIGNMENT_RULES: SecretAssignmentRule[] = [
  {
    id: "aws-secret",
    label: "AWS secret access key",
    reason: "A hardcoded AWS secret access key was found.",
    regex: AWS_SECRET_ASSIGNMENT_REGEX,
    minLength: 35
  },
  {
    id: "jwt-secret",
    label: "JWT secret",
    reason: "A hardcoded JWT secret value was found.",
    regex: JWT_SECRET_ASSIGNMENT_REGEX,
    minLength: 12
  },
  {
    id: "generic-secret",
    label: "Secret-like assignment",
    reason: "A hardcoded token/secret/password value was found.",
    regex: GENERIC_SECRET_KEYWORD_REGEX,
    minLength: 24
  }
];

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "private-key",
    label: "Private key material",
    reason: "A PEM/OpenSSH private key block was found.",
    regex: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]{20,}?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/i
  },
  {
    id: "github-token",
    label: "GitHub token",
    reason: "A token matching common GitHub token formats was found.",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/
  },
  {
    id: "openai-api-key",
    label: "OpenAI API key",
    reason: "A value matching common OpenAI API key formats was found.",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/
  },
  {
    id: "stripe-secret-key",
    label: "Stripe secret key",
    reason: "A value matching a live Stripe secret key was found.",
    regex: /\b(?:sk_live|rk_live)_[A-Za-z0-9]{20,}\b/
  },
  {
    id: "slack-token",
    label: "Slack token",
    reason: "A value matching common Slack token formats was found.",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
  },
  {
    id: "google-api-key",
    label: "Google API key",
    reason: "A value matching common Google API key formats was found.",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    id: "aws-access-key",
    label: "AWS access key",
    reason: "A value matching an AWS access key id was found.",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    id: "jwt-value",
    label: "JWT value",
    reason: "A hardcoded JWT-like value was found.",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
  },
  {
    id: "database-url",
    label: "Database URL with credentials",
    reason: "A database connection URL appears to contain embedded credentials.",
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/i
  }
];

export function scanTextForSecrets(path: string, content: string): SecretIssue[] {
  const issues: SecretIssue[] = [];

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(content)) {
      issues.push({
        id: pattern.id,
        label: pattern.label,
        reason: pattern.reason
      });
    }
  }

  issues.push(...findSecretAssignmentIssues(path, content));

  if (/\.env(?:\.|$)/i.test(path)) {
    issues.push({
      id: "env-file",
      label: "Environment file",
      reason: "Environment files can contain credentials and are blocked."
    });
  }

  return dedupeIssues(issues);
}

function findSecretAssignmentIssues(path: string, sample: string): SecretIssue[] {
  const isCodeFile = CODE_FILE_REGEX.test(path);
  const issues: SecretIssue[] = [];

  for (const line of sample.split(/\r?\n/)) {
    for (const rule of SECRET_ASSIGNMENT_RULES) {
      const match = line.match(rule.regex);
      if (!match) {
        continue;
      }

      const assignment = normalizeAssignmentValue(match[2] ?? "");
      if (!assignment.value || isSafeCodeReference(assignment, isCodeFile)) {
        continue;
      }

      if (looksLikeSecretValue(assignment.value, rule.minLength)) {
        issues.push({
          id: rule.id,
          label: rule.label,
          reason: rule.reason
        });
      }
    }
  }

  return issues;
}

function normalizeAssignmentValue(rawValue: string): AssignmentValue {
  const trimmed = rawValue.trim();
  const quoted = trimmed.match(QUOTED_VALUE_REGEX);
  if (quoted) {
    return {
      value: quoted[2] ?? "",
      quoted: true
    };
  }

  return {
    value: trimmed.split(/[,\s;#}]/)[0] ?? "",
    quoted: false
  };
}

function isSafeCodeReference(assignment: AssignmentValue, isCodeFile: boolean): boolean {
  if (!isCodeFile || assignment.quoted) {
    return false;
  }

  const { value } = assignment;
  if (CODE_REFERENCE_REGEX.test(value) || CODE_IDENTIFIER_REGEX.test(value)) {
    return true;
  }

  return value.startsWith("process.env.") || value.startsWith("import.meta.env.");
}

function looksLikeSecretValue(value: string, minLength: number): boolean {
  return value.length >= minLength && SECRET_VALUE_CHAR_REGEX.test(value);
}

function dedupeIssues(issues: SecretIssue[]): SecretIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) {
      return false;
    }
    seen.add(issue.id);
    return true;
  });
}

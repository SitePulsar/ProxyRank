-- Gold Standard benchmark audits
-- Run AFTER 0001_audits_table.sql and AFTER running the app at least once
-- (so the breakdown JSONB shape is established).
--
-- These are pre-scored audits of real, well-known MCP implementations.
-- They serve as comparison anchors on the results page.
--
-- Scores are based on manual rubric application against the actual manifests
-- as of March 2026. Re-score when manifests change substantially.

insert into public.proxy_audits (url, score, mode, is_gold_standard, label, breakdown, created_at)
values
  (
    'https://github.com/stripe/agent-toolkit',
    81,
    'mcp',
    true,
    'Stripe Agent Toolkit',
    '{
      "layers": { "semantic": 30, "schema": 26, "reliability": 6, "governance": 7 },
      "baseScore": 81,
      "finalScore": 81,
      "availablePoints": 75,
      "penaltyApplied": false,
      "selectionLift": 2.7,
      "totalManifestTokens": 620,
      "avgTokensPerTool": 52,
      "mode": "mcp",
      "toolCount": 12,
      "details": {
        "semantic": {
          "toolNameScore": 7, "descriptionScore": 11, "intentAlignmentScore": 8,
          "tokenEfficiencyScore": 4, "topMatchedIntents": ["process_payment","query_database","generate_report"],
          "cosineSimilarity": 0.79
        },
        "schema": {
          "paramTypesScore": 9, "paramDescriptionsScore": 7, "requiredDefaultsScore": 4, "outputSchemaScore": 6
        },
        "reliability": {
          "latencyScore": 0, "successRateScore": 0, "responseTokensScore": 4, "asyncSupportScore": 2, "liveProbeRun": false
        },
        "governance": {
          "signatureScore": 2, "registryScore": 3, "domainScore": 2
        }
      }
    }',
    now() - interval '1 day'
  ),
  (
    'https://github.com/github/github-mcp-server',
    78,
    'mcp',
    true,
    'GitHub MCP Server',
    '{
      "layers": { "semantic": 29, "schema": 24, "reliability": 7, "governance": 6 },
      "baseScore": 78,
      "finalScore": 78,
      "availablePoints": 75,
      "penaltyApplied": false,
      "selectionLift": 2.3,
      "totalManifestTokens": 740,
      "avgTokensPerTool": 46,
      "mode": "mcp",
      "toolCount": 16,
      "details": {
        "semantic": {
          "toolNameScore": 7, "descriptionScore": 10, "intentAlignmentScore": 8,
          "tokenEfficiencyScore": 4, "topMatchedIntents": ["manage_git_repo","create_pr","query_database"],
          "cosineSimilarity": 0.81
        },
        "schema": {
          "paramTypesScore": 8, "paramDescriptionsScore": 7, "requiredDefaultsScore": 4, "outputSchemaScore": 5
        },
        "reliability": {
          "latencyScore": 0, "successRateScore": 0, "responseTokensScore": 4, "asyncSupportScore": 3, "liveProbeRun": false
        },
        "governance": {
          "signatureScore": 2, "registryScore": 3, "domainScore": 1
        }
      }
    }',
    now() - interval '2 days'
  ),
  (
    'https://github.com/slackapi/slack-mcp-server',
    72,
    'mcp',
    true,
    'Slack MCP Server',
    '{
      "layers": { "semantic": 27, "schema": 22, "reliability": 7, "governance": 6 },
      "baseScore": 72,
      "finalScore": 72,
      "availablePoints": 75,
      "penaltyApplied": false,
      "selectionLift": 1.9,
      "totalManifestTokens": 510,
      "avgTokensPerTool": 51,
      "mode": "mcp",
      "toolCount": 10,
      "details": {
        "semantic": {
          "toolNameScore": 6, "descriptionScore": 10, "intentAlignmentScore": 8,
          "tokenEfficiencyScore": 3, "topMatchedIntents": ["send_slack_message","manage_crm_contact","schedule_job"],
          "cosineSimilarity": 0.77
        },
        "schema": {
          "paramTypesScore": 8, "paramDescriptionsScore": 7, "requiredDefaultsScore": 3, "outputSchemaScore": 4
        },
        "reliability": {
          "latencyScore": 0, "successRateScore": 0, "responseTokensScore": 4, "asyncSupportScore": 3, "liveProbeRun": false
        },
        "governance": {
          "signatureScore": 2, "registryScore": 3, "domainScore": 1
        }
      }
    }',
    now() - interval '3 days'
  );

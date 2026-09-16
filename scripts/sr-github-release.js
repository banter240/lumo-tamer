/**
 * semantic-release publish plugin.
 * Create the GitHub release, or update notes if this tag already has one
 * (retry after a successful POST, leftover from a failed job, tag-push race).
 */

async function github(path, { method = "GET", token, body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }
  return { res, json };
}

export async function publish(_pluginConfig, context) {
  const {
    env,
    logger,
    branch,
    nextRelease: { gitTag, notes },
  } = context;
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!repo || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  }

  const payload = {
    tag_name: gitTag,
    target_commitish: branch.name,
    name: gitTag,
    body: notes || "",
    prerelease: Boolean(branch.prerelease),
    make_latest: branch.name === "main" ? "true" : "false",
  };

  let { res, json } = await github(`/repos/${repo}/releases`, {
    method: "POST",
    token,
    body: payload,
  });

  if (res.status === 422) {
    logger.log("GitHub release %s already exists — updating notes", gitTag);
    const existing = await github(`/repos/${repo}/releases/tags/${encodeURIComponent(gitTag)}`, { token });
    if (!existing.res.ok || !existing.json.id) {
      throw new Error(
        `GitHub release ${gitTag} exists but could not be loaded (${existing.res.status}): ${existing.json.message || ""}`,
      );
    }
    ({ res, json } = await github(`/repos/${repo}/releases/${existing.json.id}`, {
      method: "PATCH",
      token,
      body: {
        name: payload.name,
        body: payload.body,
        prerelease: payload.prerelease,
        make_latest: payload.make_latest,
      },
    }));
  }

  if (!res.ok) {
    throw new Error(`GitHub release failed (${res.status}): ${json.message || JSON.stringify(json)}`);
  }

  logger.log("GitHub release: %s", json.html_url);
  return { url: json.html_url, name: "GitHub release" };
}

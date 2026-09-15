function identifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function headerValue(headers, name) {
  return identifier(headers?.get?.(name));
}

export function extractImageGenerationIdentifiers(payload, headers) {
  return {
    taskId: identifier(payload?.task_id)
      || identifier(payload?.taskId)
      || identifier(payload?.data?.[0]?.task_id)
      || identifier(payload?.data?.[0]?.taskId)
      || headerValue(headers, "x-task-id"),
    generationId: identifier(payload?.id)
      || identifier(payload?.generation_id)
      || identifier(payload?.generationId)
      || identifier(payload?.data?.[0]?.id),
    requestId: headerValue(headers, "x-request-id"),
  };
}

export function responseGenerationIdentifiers(headers) {
  return {
    taskId: headerValue(headers, "x-yumeew-task-id") || headerValue(headers, "x-task-id"),
    generationId: headerValue(headers, "x-yumeew-generation-id") || headerValue(headers, "x-generation-id"),
    requestId: headerValue(headers, "x-yumeew-request-id") || headerValue(headers, "x-request-id"),
  };
}

export function generationIdentifierHeaders({ taskId = "", generationId = "", requestId = "" } = {}) {
  const headers = {};
  if (taskId) headers["X-YuMeew-Task-ID"] = taskId;
  if (generationId) headers["X-YuMeew-Generation-ID"] = generationId;
  if (requestId) headers["X-YuMeew-Request-ID"] = requestId;
  return headers;
}

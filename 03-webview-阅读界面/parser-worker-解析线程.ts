/// <reference lib="webworker" />

import type {
  ParserWorkerRequest,
  ParserWorkerResponse
} from "../02-core-核心能力/reader-model-阅读模型";
import { parseYamlDocument } from "../02-core-核心能力/yaml-parser-YAML解析器";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener(
  "message",
  (event: MessageEvent<ParserWorkerRequest>) => {
    const request = event.data;
    if (
      request?.type !== "parse" ||
      !Number.isInteger(request.requestId) ||
      typeof request.text !== "string"
    ) {
      return;
    }

    let response: ParserWorkerResponse;
    try {
      response = {
        type: "parse/success",
        requestId: request.requestId,
        result: parseYamlDocument(request.text)
      };
    } catch (error) {
      response = {
        type: "parse/failure",
        requestId: request.requestId,
        message:
          error instanceof Error ? error.message : "Unknown parser failure"
      };
    }
    workerScope.postMessage(response);
  }
);

export {};

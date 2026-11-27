# Support multiple request directories

Support multiple request directories in `~/.llm/config.json`. Keep `requestsDirectory` (string) and add `requestDirectories` (string[]). Support both by scanning both the variable and every array element for requests when resolving which `llm req <request-name>` the caller is invoking.

# Add claude provider

# Details

Add a new provider, make it the default, called 'claude' that invokes 'claude' in an efficient way to process llm requests. This will need to implement the LlmProvider interface and be resolvable via the various mechanisms for selecting a provider. It's very important that it is set as the default moving forward as well
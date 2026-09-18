# Reviewable application source

Nicotine applications must be easy for humans and automated reviewers to
understand before installation, using extracted source without executing it.
Small applications should result from a small amount of necessary logic and
shared runtime capabilities. Source readability takes priority over code density.

When writing or changing an app:

- Use descriptive names, consistent formatting, short functions with clear
  responsibilities, and straightforward control flow. Avoid compressed
  expressions, hidden side effects, and clever metaprogramming.
- Make entry points, event handlers, state changes, and error paths easy to
  follow. Comment intent and native API assumptions where they are not obvious.
- Keep native library and symbol names visible in source. Prefer a small,
  clearly identified binding section or helper functions. Use explicit types
  when inference is ambiguous; explain pointer ownership, buffer layout,
  callback lifetime, and retained references where relevant. Lazy linking
  remains a runtime feature and does not require hiding the calls in app code.
- Make effects easy to locate: network destinations and transmitted data,
  files or settings read and written, process launches, and native calls.
  Explain how external input influences these effects and validate it at
  the boundary. Do not treat downloaded content as executable code.
- Avoid eval, Function constructors, generated executable source, obfuscation,
  and encoded executable payloads. Ship the readable source that actually runs,
  with its assets and dependencies available for inspection.
- Keep platform differences in clearly named adapters. Any app-specific native
  code is part of the application's review scope; it must not be hidden behind
  the standard runtime's signature.

An app's accompanying documentation should briefly identify its entry point,
required runtime/ABI, native dependencies, external effects, and the commands
used to validate its behavior. A reviewer should be able to trace an input or
event to its effects without reconstructing generated code.

Review results should identify the exact payload hashes and runtime version
reviewed. Changes to executable source or native dependencies require a new
review. An AI review is evidence for a decision, not a guarantee of safety;
the runtime signature authenticates the runtime, not the application's behavior.

These are authoring and delivery requirements, not restrictions currently
enforced by the prototype. Existing examples may need further cleanup to meet
them fully. Packaging and signing capabilities are described separately in the
README.

#![feature(char_indices_offset)]
use std::convert::Infallible;

use js_sys::JsString;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    pub type Resolver;

    #[wasm_bindgen(method, catch)]
    fn resolve(
        this: &Resolver,
        path: JsString,
        start_line: u32,
        start_char: u32,
        end_line: u32,
        end_char: u32,
        base_path: &JsString,
    ) -> Result<String, JsValue>;

    #[wasm_bindgen(method, catch, js_name = getText)]
    async fn get_text(this: &Resolver, resolved_path: &JsString) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(method, js_name = addDiagnostic)]
    fn add_diagnostic(
        this: &Resolver,
        msg: &JsString,
        path: &JsString,
        start_line: u32,
        start_char: u32,
        end_line: u32,
        end_char: u32,
    );
}

#[wasm_bindgen]
pub async fn load_nickel_file(resolver: Resolver, path: String) -> Result<JsValue, JsValue> {
    // Parse and resolve all files in the import graph, starting at `path`.
    let mut cache = nickel_lang::cache::Cache::new(nickel_lang::cache::ErrorTolerance::Tolerant);
    let mut to_parse = vec![path.clone()];

    while let Some(resolved_path) = to_parse.pop() {
        // Cache and parse path.
        let js_resolved_path = JsString::from(resolved_path.as_str());
        let text = resolver
            .get_text(&js_resolved_path)
            .await?
            .as_string()
            .expect_throw("returned string should always be utf-8");
        let text_format = if text.ends_with("json") {
            nickel_lang::cache::InputFormat::Json
        } else {
            nickel_lang::cache::InputFormat::Nickel
        };
        let file_id = cache.add_string(resolved_path, text);
        let term = {
            // TODO: report diagnostics
            let cache_op = cache
                .parse_multi(file_id, text_format)
                .map_err(|err| js_sys::Error::new(&format!("{err:#?}")))?;

            assert!(matches!(cache_op, nickel_lang::cache::CacheOp::Done(_)));

            cache
                .get_ref(file_id)
                .expect_throw("cache should always contain id if no errors were encountered")
                .clone()
        };

        // Discover all imports in the term.
        let mut to_resolve = Vec::new();
        let _ = term.traverse(
            &|term, to_resolve: &mut Vec<_>| {
                if let nickel_lang::term::Term::Import(import) = term.as_ref() {
                    to_resolve.push((import.clone(), term.pos));
                }

                Ok::<_, Infallible>(term)
            },
            &mut to_resolve,
            nickel_lang::term::TraverseOrder::TopDown,
        );

        // Resolve all imports in the term.
        //
        // Note that we expect all positions to be sorted and not to overlap;
        // this should be fine since imports cannot contain other imports.
        let text = cache.files().source(file_id);
        let (mut chars, mut line, mut char) = (text.char_indices(), 0, 0);

        for (unresolved_path, pos) in to_resolve {
            let (start_line, start_char, end_line, end_char) = if let Some(pos) = pos.as_opt_ref() {
                let (sl, sc) =
                    resolve_utf16_position_to(&mut chars, &mut line, &mut char, pos.start.0);
                let (el, ec) =
                    resolve_utf16_position_to(&mut chars, &mut line, &mut char, pos.end.0);

                (sl, sc, el, ec)
            } else {
                (0, 0, 0, 0)
            };

            let unresolved_path_utf8 = unresolved_path.to_str().ok_or_else(|| {
                js_sys::Error::new(&format!("file {unresolved_path:?} is not valid utf-8"))
            })?;
            let resolved_path = resolver.resolve(
                JsString::from(unresolved_path_utf8),
                start_line,
                start_char,
                end_line,
                end_char,
                &js_resolved_path,
            )?;

            if cache.id_of(&resolved_path).is_none() {
                to_parse.push(resolved_path);
            }
        }
    }

    // Evaluate root term to an object.
    let root_file_id = cache
        .id_of(&path)
        .expect_throw("entry for root path should exist");
    let root_term = cache
        .get_ref(root_file_id)
        .expect_throw("entry for root path should exist")
        .clone();

    let mut vm = nickel_lang::eval::VirtualMachine::new(cache);
    let result = vm
        .eval_full(root_term, &nickel_lang::environment::Environment::new())
        .map_err(|err| js_sys::EvalError::new(&format!("{err:#?}")))?;

    // Convert resulting object to a JS object.
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_bytes_as_arrays(true)
        .serialize_maps_as_objects(true);

    Ok(result.term.as_ref().serialize(&serializer)?)
}

/// Returns the UTF-16 `(line, character)` position at the given `target_offset`
/// in `chars`.
fn resolve_utf16_position_to(
    chars: &mut std::str::CharIndices,
    line: &mut u32,
    char: &mut u32,
    target_offset: u32,
) -> (u32, u32) {
    let target_offset = target_offset as usize;

    loop {
        if chars.offset() == target_offset {
            break;
        }

        let Some((_, ch)) = chars.next() else { break };

        match ch {
            '\r' => {
                // Ignore.
            }
            '\n' => {
                *line += 1;
                *char = 0;
            }
            _ => {
                *char += ch.len_utf16() as u32;
            }
        }
    }

    (*line, *char)
}

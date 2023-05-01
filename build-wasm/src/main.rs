fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(input), Some(out_dir)) = (args.next(), args.next()) else {
        panic!("two arguments must be given: [input] [out-dir]")
    };
    wasm_bindgen_cli_support::Bindgen::new()
        .web(true)
        .unwrap()
        .input_path(input)
        .generate(out_dir)
        .unwrap();
}

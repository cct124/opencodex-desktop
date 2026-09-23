fn main() {
    // Desktop and the bundled proxy have independent release lines. Embed the
    // expected proxy version so replacing just one part is still detected.
    for source in ["../package.json", "../../package.json"] {
        println!("cargo:rerun-if-changed={source}");
    }
    let read_version = |path| {
        let package: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        package["version"].as_str().unwrap().to_owned()
    };
    assert_eq!(
        read_version("../package.json"),
        env!("CARGO_PKG_VERSION"),
        "Keep desktop-fork/package.json and desktop-fork/src-tauri/Cargo.toml versions in sync"
    );
    println!(
        "cargo:rustc-env=OPENCODEX_RUNTIME_VERSION={}",
        read_version("../../package.json")
    );
    // Reuse the upstream favicon verbatim; ICO supports a PNG payload on Windows.
    let source = "../../gui/public/favicon.png";
    println!("cargo:rerun-if-changed={source}");
    let png = std::fs::read(source).expect("Missing upstream favicon");
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    assert!((1..=256).contains(&width) && (1..=256).contains(&height));
    let mut ico = vec![
        0,
        0,
        1,
        0,
        1,
        0,
        width as u8,
        height as u8,
        0,
        0,
        1,
        0,
        32,
        0,
    ];
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&png);
    let icon = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("desktop.ico");
    std::fs::write(&icon, ico).unwrap();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(icon)),
    )
    .unwrap();
}

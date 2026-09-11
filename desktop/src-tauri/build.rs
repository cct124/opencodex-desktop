fn main() {
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

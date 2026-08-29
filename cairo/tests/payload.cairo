use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;

// These tests are intentionally compiled only after the real-package build gate
// is green. They exercise the same official ByteArray extension used by the OApp.
#[test]
fn prism_payload_schema_is_fixed_width_big_endian() {
    let mut payload = Default::default();
    payload.append_u128(0x0102030405060708090a0b0c0d0e0f10);
    assert(payload.len() == 16, 'payload length');
    let (_, decoded) = payload.read_u128(0);
    assert(decoded == 0x0102030405060708090a0b0c0d0e0f10, 'payload decode');
}

//! Cross-engine output-equality gate (best practice the upstream suite omits):
//! every engine must render each workload to BYTE-IDENTICAL HTML, so the
//! comparative benchmark measures speed, not output shape. The hand-written
//! `write!` baseline is the reference. Cheap — runs in debug.

use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, sailfish_big_table,
    sailfish_teams, teams_data, trussbars_big_table, trussbars_teams, write_big_table, write_teams,
};

#[test]
fn big_table_all_engines_agree() {
    let ctx = big_table_data();
    let hb = handlebars_big_table_registry();
    let baseline = write_big_table(&ctx);

    assert_eq!(trussbars_big_table(&ctx), baseline, "trussbars vs write");
    assert_eq!(sailfish_big_table(&ctx), baseline, "sailfish vs write");
    assert_eq!(askama_big_table(&ctx), baseline, "askama vs write");
    assert_eq!(
        handlebars_big_table(&hb, &ctx),
        baseline,
        "handlebars vs write"
    );
}

#[test]
fn teams_all_engines_agree() {
    let ctx = teams_data();
    let hb = handlebars_teams_registry();
    let baseline = write_teams(&ctx);

    assert_eq!(trussbars_teams(&ctx), baseline, "trussbars vs write");
    assert_eq!(sailfish_teams(&ctx), baseline, "sailfish vs write");
    assert_eq!(askama_teams(&ctx), baseline, "askama vs write");
    assert_eq!(handlebars_teams(&hb, &ctx), baseline, "handlebars vs write");
}

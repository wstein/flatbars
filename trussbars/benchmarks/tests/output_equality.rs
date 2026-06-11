//! Cross-engine output-equality gate (best practice the upstream suite omits):
//! every engine must render each workload to BYTE-IDENTICAL HTML, so the
//! comparative benchmark measures speed, not output shape. The hand-written
//! `write!` baseline is the reference. Cheap — runs in debug.

use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, big_table_value, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, interp_big_table,
    interp_big_table_template, interp_teams, interp_teams_template, liquid_big_table,
    liquid_big_table_template, liquid_teams, liquid_teams_template, sailfish_big_table,
    sailfish_teams, teams_data, teams_value, tera_big_table, tera_engine, tera_teams,
    trussbars_big_table, trussbars_teams, vm_big_table, vm_big_table_program, vm_teams,
    vm_teams_program, vy_big_table, vy_teams, write_big_table, write_teams,
};

#[test]
fn big_table_all_engines_agree() {
    let ctx = big_table_data();
    let hb = handlebars_big_table_registry();
    let baseline = write_big_table(&ctx);

    assert_eq!(
        trussbars_big_table(&ctx),
        baseline,
        "trussbars (AOT) vs write"
    );
    assert_eq!(
        interp_big_table(&interp_big_table_template(), &big_table_value(&ctx)),
        baseline,
        "trussbars-interp vs write"
    );
    assert_eq!(
        vm_big_table(&vm_big_table_program(), &big_table_value(&ctx)),
        baseline,
        "trussbars-vm (bytecode) vs write"
    );
    assert_eq!(sailfish_big_table(&ctx), baseline, "sailfish vs write");
    assert_eq!(vy_big_table(&ctx), baseline, "vy vs write");
    assert_eq!(askama_big_table(&ctx), baseline, "askama vs write");
    assert_eq!(
        handlebars_big_table(&hb, &ctx),
        baseline,
        "handlebars vs write"
    );
    assert_eq!(
        liquid_big_table(&liquid_big_table_template(), &ctx),
        baseline,
        "liquid vs write"
    );
    assert_eq!(
        tera_big_table(&tera_engine(), &ctx),
        baseline,
        "tera vs write"
    );
}

#[test]
fn teams_all_engines_agree() {
    let ctx = teams_data();
    let hb = handlebars_teams_registry();
    let baseline = write_teams(&ctx);

    assert_eq!(trussbars_teams(&ctx), baseline, "trussbars (AOT) vs write");
    assert_eq!(
        interp_teams(&interp_teams_template(), &teams_value(&ctx)),
        baseline,
        "trussbars-interp vs write"
    );
    assert_eq!(
        vm_teams(&vm_teams_program(), &teams_value(&ctx)),
        baseline,
        "trussbars-vm (bytecode) vs write"
    );
    assert_eq!(sailfish_teams(&ctx), baseline, "sailfish vs write");
    assert_eq!(vy_teams(&ctx), baseline, "vy vs write");
    assert_eq!(askama_teams(&ctx), baseline, "askama vs write");
    assert_eq!(handlebars_teams(&hb, &ctx), baseline, "handlebars vs write");
    assert_eq!(
        liquid_teams(&liquid_teams_template(), &ctx),
        baseline,
        "liquid vs write"
    );
    assert_eq!(tera_teams(&tera_engine(), &ctx), baseline, "tera vs write");
}

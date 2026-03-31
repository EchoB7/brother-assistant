use std::env;

use brother_core::agent::collect_system_info;
use brother_core::chat::ChatMessage;
use brother_core::config::{config_path, load_config};
use brother_core::runtime::{
    collect_chat_response, DEFAULT_AGENT_PLANNER_PROMPT, DEFAULT_SYSTEM_PROMPT,
};

enum CliCommand {
    Help,
    Status,
    ConfigPath,
    SystemInfo,
    Ask(String),
    Agent(String),
}

fn parse_args() -> Result<(CliCommand, bool), String> {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    let json_output = take_flag(&mut args, "--json");

    let mut args = args.into_iter();
    let Some(command) = args.next() else {
        return Ok((CliCommand::Help, json_output));
    };

    match command.as_str() {
        "help" | "--help" | "-h" => Ok((CliCommand::Help, json_output)),
        "status" => Ok((CliCommand::Status, json_output)),
        "config-path" => Ok((CliCommand::ConfigPath, json_output)),
        "system-info" => Ok((CliCommand::SystemInfo, json_output)),
        "ask" => {
            let prompt = args.collect::<Vec<_>>().join(" ");
            if prompt.trim().is_empty() {
                Err("Informe a pergunta após 'ask'.\n\n".to_string() + &usage())
            } else {
                Ok((CliCommand::Ask(prompt), json_output))
            }
        }
        "agent" => {
            let prompt = args.collect::<Vec<_>>().join(" ");
            if prompt.trim().is_empty() {
                Err("Informe a instrução após 'agent'.\n\n".to_string() + &usage())
            } else {
                Ok((CliCommand::Agent(prompt), json_output))
            }
        }
        _ => Err(usage()),
    }
}

fn take_flag(args: &mut Vec<String>, flag: &str) -> bool {
    if let Some(index) = args.iter().position(|value| value == flag) {
        args.remove(index);
        true
    } else {
        false
    }
}

fn usage() -> String {
    [
        "Brother Linux CLI",
        "",
        "Uso:",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- status",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- status --json",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- config-path",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- system-info",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- ask Explique este erro",
        "  cargo run --manifest-path linux-cli/Cargo.toml -- agent dados do meu pc",
    ]
    .join("\n")
}

async fn run_prompt(prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut config = load_config();
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt.to_string(),
    }];

    collect_chat_response(
        &client,
        &mut config,
        &messages,
        DEFAULT_SYSTEM_PROMPT,
        DEFAULT_AGENT_PLANNER_PROMPT,
    )
    .await
}

#[tokio::main]
async fn main() {
    let parsed = parse_args();
    let json_output = parsed.as_ref().map(|(_, json)| *json).unwrap_or(false);

    let result = match parsed {
        Ok((CliCommand::Help, _)) => Ok(usage()),
        Ok((CliCommand::Status, _)) => {
            let config = load_config();
            Ok(format!(
                "provider: {}\nmodel: {}\nagent_mode: {}\nconfig: {}",
                config.provider,
                config.model,
                config.agent_mode,
                config_path().display()
            ))
        }
        Ok((CliCommand::ConfigPath, _)) => Ok(config_path().display().to_string()),
        Ok((CliCommand::SystemInfo, _)) => Ok(collect_system_info()),
        Ok((CliCommand::Ask(prompt), _)) => run_prompt(&prompt).await,
        Ok((CliCommand::Agent(prompt), _)) => run_prompt(&prompt).await,
        Err(message) => Err(message),
    };

    match result {
        Ok(output) if json_output => {
            println!(
                "{}",
                serde_json::json!({
                    "ok": true,
                    "output": output,
                })
            );
        }
        Ok(output) => println!("{}", output),
        Err(error) if json_output => {
            eprintln!(
                "{}",
                serde_json::json!({
                    "ok": false,
                    "error": error,
                })
            );
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("{}", error);
            std::process::exit(1);
        }
    }
}
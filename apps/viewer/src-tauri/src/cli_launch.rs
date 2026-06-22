//! CLI for the LISCA viewer: `server` subcommand.

use clap::{Args, Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(version, about = "LISCA desktop shell")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<CliCommand>,
}

#[derive(Subcommand, Debug)]
pub enum CliCommand {
    /// Run WebSocket RPC server only (no window).
    Server(ServerCli),
}

#[derive(Args, Debug)]
pub struct ServerCli {
    /// WebSocket listen port (default 3412).
    #[arg(long, value_name = "WS_PORT")]
    pub port: Option<u16>,
    /// Listen on 0.0.0.0 instead of 127.0.0.1.
    #[arg(long)]
    pub lan: bool,
}

pub fn server_listen_addr(port: u16, lan: bool) -> String {
    if lan {
        format!("0.0.0.0:{port}")
    } else {
        format!("127.0.0.1:{port}")
    }
}

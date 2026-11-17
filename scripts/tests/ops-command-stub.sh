#!/usr/bin/env bash
# External commands only. No branch may fall through to the real executable.
set -eu
command_name=${0##*/}
printf '%s' "$command_name" >> "$OPS_LOG"
printf '\t%s' "$@" >> "$OPS_LOG"
printf '\n' >> "$OPS_LOG"
case "$command_name" in
  pg_dump)
    [ "${DUMP_EMPTY:-0}" = 1 ] || printf 'CREATE TABLE fixture (id integer);\n'
    exit "${DUMP_EXIT:-0}"
    ;;
  psql)
    sql=''
    file=''
    stop=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -c|--command) sql=$2; shift ;;
        -f|--file) file=$2; shift ;;
        ON_ERROR_STOP=1) stop=1 ;;
      esac
      shift
    done
    if [ -n "$file" ]; then sql=$(cat "$file"); fi
    if [ -z "$sql" ]; then sql=$(cat); fi
    printf 'SQL\t%s\n' "${sql//$'\n'/ }" >> "$OPS_LOG"
    if [[ "$sql" == *'DROP DATABASE'* && "$sql" == *'CREATE DATABASE'* && "${ALLOW_COMBINED_DDL:-0}" != 1 ]]; then
      echo 'ERROR: DROP DATABASE cannot run inside a transaction block' >&2
      exit 1
    fi
    if [[ -n "${SQL_FAIL_MATCH:-}" && "$sql" == *"$SQL_FAIL_MATCH"* ]]; then
      echo 'ERROR: injected SQL failure' >&2
      if [ "$stop" = 1 ]; then exit 3; fi
    fi
    ;;
  git)
    case "$1" in
      remote) echo origin ;;
      pull) exit 0 ;;
      status)
        [ "${GIT_STATUS_FAIL:-0}" = 0 ] || exit 1
        printf '%s' "${GIT_DIRTY:-}"
        ;;
      rev-parse) printf '%s\n' "${GIT_HEAD:-$OPS_REV}" ;;
      ls-remote)
        [ "${REMOTE_FAIL:-0}" = 0 ] || exit 1
        printf '%s\trefs/heads/main\n' "${REMOTE_REV:-$OPS_REV}"
        ;;
      archive)
        [ "${ARCHIVE_FAIL:-0}" = 0 ] || exit 1
        output=''
        while [ "$#" -gt 0 ]; do
          if [ "$1" = --output ]; then output=$2; shift; fi
          shift
        done
        tar -cf "$output" -C "$OPS_ARCHIVE" .
        ;;
      *) echo "Unexpected git command: $1" >&2; exit 97 ;;
    esac
    ;;
  docker)
    if [[ -n "${DOCKER_FAIL_MATCH:-}" && " $* " == *"$DOCKER_FAIL_MATCH"* ]]; then exit 1; fi
    case "$1" in
      inspect)
        case "$*" in
          *com.docker.compose.project*)
            if [ "${*: -1}" = container-web ]; then echo "${WEB_PROJECT:-${DOCKER_PROJECT:-kayford-deploy}}";
            else echo "${DOCKER_PROJECT:-kayford-deploy}"; fi
            ;;
          *com.docker.compose.service*)
            if [ "${*: -1}" = container-web ]; then echo "${WEB_SERVICE:-web}";
            else echo "${*: -1}" | sed 's/^container-//'; fi
            ;;
          *org.opencontainers.image.revision*) echo "${DEPLOYED_REV:-$OPS_REV}" ;;
          *'{{.Image}}'*) echo 'sha256:fixture-old-image' ;;
          *) exit 96 ;;
        esac
        ;;
      tag) ;;
      exec)
        case " $* " in
          *' container-api node -e '*)
            attempts=0
            if [ -f "$OPS_LOG.ready" ]; then attempts=$(cat "$OPS_LOG.ready"); fi
            attempts=$((attempts + 1))
            printf '%s' "$attempts" > "$OPS_LOG.ready"
            [ "$attempts" -gt "${API_READY_AFTER:-0}" ] || exit 1
            ;;
          *' container-web nginx -t '*) ;;
          *' container-web nginx -s reload '*)
            if [ "${REQUIRE_WEB_RELOAD:-0}" = 1 ]; then
              [ -f "$OPS_LOG.ready" ] || exit 1
              [ "$(cat "$OPS_LOG.ready")" -gt "${API_READY_AFTER:-0}" ] || exit 1
            fi
            printf '172.20.0.9' > "$OPS_LOG.web-upstream"
            ;;
          *) echo 'Unexpected docker exec target/operation' >&2; exit 92 ;;
        esac
        ;;
      compose)
        case " $* " in
          *' ps -q '*) printf 'container-%s\n' "${*: -1}" ;;
          *' up '*)
            if [ "${REQUIRE_WEB_RELOAD:-0}" = 1 ]; then
              printf '172.20.0.4' > "$OPS_LOG.web-upstream"
            fi
            ;;
          *' config --quiet '*|*' build '*|*' run '*) ;;
          *) echo 'Unexpected compose operation' >&2; exit 95 ;;
        esac
        ;;
      *) echo 'Unexpected docker operation' >&2; exit 94 ;;
    esac
    ;;
  curl)
    [ "${HEALTH_FAIL:-0}" = 0 ] || exit 22
    if [ "${REQUIRE_WEB_RELOAD:-0}" = 1 ]; then
      [ -f "$OPS_LOG.web-upstream" ] && [ "$(cat "$OPS_LOG.web-upstream")" = '172.20.0.9' ] || exit 22
    fi
    printf '%s\n' '{"code":0,"data":{"status":"ok","db":"ok"}}'
    ;;
  sleep) ;;
  gzip)
    if [ "${GZIP_FAIL:-0}" = 1 ]; then exit 1; fi
    if [ "${GZIP_CORRUPT:-0}" = 1 ] && [ "$1" = -c ]; then
      printf 'corrupt output'; exit 0
    fi
    exec /usr/bin/gzip "$@"
    ;;
  mv)
    [ "${FINALIZE_FAIL:-0}" = 0 ] || exit 1
    exec /usr/bin/mv "$@"
    ;;
  *) echo "Unimplemented stub: $command_name" >&2; exit 93 ;;
esac

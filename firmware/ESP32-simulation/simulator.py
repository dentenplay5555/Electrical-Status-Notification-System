#!/usr/bin/env python3

import argparse
import json
import os
import random
import signal
import time
from dataclasses import dataclass

import requests


@dataclass
class Sensor:
    sensor_id: str
    mode: str = "random"
    on_seconds: float = 10
    off_seconds: float = 10
    state: bool = False
    state_started: float = 0


def parse_schedule(value):
    """
    Example:

    sensor-1=on:20,off:10;sensor-2=random;sensor-3=off
    """

    result = {}

    if not value:
        return result

    for item in value.split(";"):
        if not item.strip():
            continue

        sensor_id, spec = item.split("=", 1)

        sensor_id = sensor_id.strip()
        spec = spec.strip().lower()

        if spec in ("random", "on", "off"):
            result[sensor_id] = {
                "mode": spec
            }
            continue

        parts = {}

        for part in spec.split(","):
            key, value_str = part.split(":", 1)

            if key not in ("on", "off"):
                raise ValueError(
                    f"Invalid schedule key: {key}"
                )

            duration = float(value_str)

            if duration <= 0:
                raise ValueError(
                    "Schedule duration must be > 0"
                )

            parts[key] = duration

        if "on" not in parts or "off" not in parts:
            raise ValueError(
                f"Schedule requires on and off: {spec}"
            )

        result[sensor_id] = {
            "mode": "schedule",
            "on": parts["on"],
            "off": parts["off"],
        }

    return result


class ESP32Simulator:

    def __init__(self, args):
        self.args = args
        self.start_time = time.monotonic()
        self.running = True
        self.sequence = 0

        self.session = requests.Session()

        self.sensors = self.create_sensors()

    def create_sensors(self):

        schedules = parse_schedule(
            self.args.schedule
        )

        sensors = []

        now = time.monotonic()

        for i in range(1, self.args.sensors + 1):

            sensor_id = f"sensor-{i}"

            config = schedules.get(sensor_id)

            if config:

                mode = config["mode"]

                if mode == "schedule":

                    sensor = Sensor(
                        sensor_id=sensor_id,
                        mode="schedule",
                        on_seconds=config["on"],
                        off_seconds=config["off"],
                        state=False,
                        state_started=now,
                    )

                else:

                    sensor = Sensor(
                        sensor_id=sensor_id,
                        mode=mode,
                        state=(mode == "on"),
                        state_started=now,
                    )

            else:

                sensor = Sensor(
                    sensor_id=sensor_id,
                    mode=self.args.mode,
                    state=(self.args.mode == "on"),
                    state_started=now,
                )

            sensors.append(sensor)

        return sensors

    def update_sensor_state(self, sensor):

        now = time.monotonic()

        if sensor.mode == "on":
            sensor.state = True
            return

        if sensor.mode == "off":
            sensor.state = False
            return

        if sensor.mode == "random":

            if random.random() < self.args.toggle_rate:
                sensor.state = not sensor.state

            return

        if sensor.mode == "schedule":

            duration = (
                sensor.on_seconds
                if sensor.state
                else sensor.off_seconds
            )

            if now - sensor.state_started >= duration:

                sensor.state = not sensor.state
                sensor.state_started = now

    def generate_sensor(self, sensor):

        self.update_sensor_state(sensor)

        is_on = sensor.state

        voltage = random.gauss(
            self.args.voltage,
            self.args.voltage_noise
        )

        if is_on:

            current = random.gauss(
                self.args.current,
                self.args.current_noise
            )

            current = max(0, current)

        else:

            current = random.gauss(
                0,
                self.args.off_current_noise
            )

            current = max(0, current)

            if current < self.args.off_threshold:
                current = 0

        power = voltage * current

        ok = (
            random.random()
            >= self.args.sensor_error_rate
        )

        if not ok:

            voltage = 0
            current = 0
            power = 0

        return {
            "sensor_id": sensor.sensor_id,
            "voltage_v": round(voltage, 3),
            "current_ma": round(current, 3),
            "power_mw": round(power, 3),
            "is_on": bool(is_on),
            "ok": bool(ok),
        }

    def build_payload(self):

        self.sequence += 1

        return {
            "device_id": self.args.device_id,

            "sensors": [
                self.generate_sensor(sensor)
                for sensor in self.sensors
            ],
        }

    def network_failed(self):

        elapsed = (
            time.monotonic()
            - self.start_time
        )

        # Random failure
        if random.random() < self.args.failure_rate:
            return True

        # Scheduled outage
        if self.args.outage_after is not None:

            outage_end = (
                self.args.outage_after
                + self.args.outage_duration
            )

            if (
                self.args.outage_after
                <= elapsed
                < outage_end
            ):
                return True

        return False

    def send(self, payload):

        if self.args.dry_run:
            return

        if self.network_failed():

            print(
                "[NET] simulated network failure"
            )

            return

        try:

            headers = {
                "Content-Type": "application/json",
            }
            if self.args.token:
                headers["Authorization"] = f"Bearer {self.args.token}"

            response = self.session.post(
                self.args.endpoint,
                json=payload,
                timeout=self.args.timeout,
                headers=headers,
            )

            if 200 <= response.status_code < 300:

                print(
                    f"[API] ส่งสำเร็จ "
                    f"(HTTP {response.status_code})"
                )

            else:

                print(
                    f"[API] ส่งไม่สำเร็จ "
                    f"(HTTP {response.status_code})"
                )

                print(
                    response.text[:200]
                )

        except requests.RequestException as e:

            print(
                f"[NET] request error: {e}"
            )

    def print_payload(self, payload):

        if self.args.pretty:

            print(
                json.dumps(
                    payload,
                    ensure_ascii=False,
                    indent=2,
                )
            )

        else:

            print(
                json.dumps(
                    payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )

    def run_once(self):

        payload = self.build_payload()

        elapsed = (
            time.monotonic()
            - self.start_time
        )

        print(
            f"\n[{elapsed:7.1f}s] "
            f"seq={self.sequence}"
        )

        if (
            self.args.show_json
            or self.args.dry_run
        ):
            self.print_payload(payload)

        self.send(payload)

    def run(self):

        print("=== ESP32 Simulator ===")
        print(
            f"device   : "
            f"{self.args.device_id}"
        )
        print(
            f"endpoint : "
            f"{self.args.endpoint}"
        )
        print(
            f"sensors  : "
            f"{self.args.sensors}"
        )
        print(
            f"interval : "
            f"{self.args.interval}s"
        )
        print(
            f"token    : "
            f"{'*' * 8 if self.args.token else '(none)'}"
        )

        print(
            "\nPress Ctrl+C to stop.\n"
        )

        while self.running:

            started = time.monotonic()

            self.run_once()

            elapsed = (
                time.monotonic()
                - started
            )

            sleep_time = max(
                0,
                self.args.interval - elapsed
            )

            try:
                time.sleep(sleep_time)

            except KeyboardInterrupt:

                self.stop()

    def stop(self, *_):

        if self.running:
            print(
                "\n[SIM] stopping..."
            )

        self.running = False

        self.session.close()


def create_parser():

    parser = argparse.ArgumentParser(
        description="ESP32 Sensor Simulator"
    )

    parser.add_argument(
        "--endpoint",
        default="http://localhost:8787/update",
    )

    parser.add_argument(
        "--token",
        default=os.getenv("DEVICE_TOKEN", ""),
        help="Bearer token for /update endpoint (defaults to DEVICE_TOKEN env var)",
    )

    parser.add_argument(
        "--device-id",
        default="esp32-sim-001",
    )

    parser.add_argument(
        "--sensors",
        type=int,
        default=2,
    )

    parser.add_argument(
        "--interval",
        type=float,
        default=5,
    )

    parser.add_argument(
        "--timeout",
        type=float,
        default=5,
    )

    parser.add_argument(
        "--mode",
        choices=[
            "random",
            "on",
            "off",
        ],
        default="random",
    )

    parser.add_argument(
        "--schedule",
        help=(
            "sensor-1=on:20,off:10;"
            "sensor-2=random"
        ),
    )

    parser.add_argument(
        "--toggle-rate",
        type=float,
        default=0.2,
    )

    parser.add_argument(
        "--voltage",
        type=float,
        default=220,
    )

    parser.add_argument(
        "--voltage-noise",
        type=float,
        default=1.5,
    )

    parser.add_argument(
        "--current",
        type=float,
        default=500,
    )

    parser.add_argument(
        "--current-noise",
        type=float,
        default=50,
    )

    parser.add_argument(
        "--off-current-noise",
        type=float,
        default=2,
    )

    parser.add_argument(
        "--off-threshold",
        type=float,
        default=20,
    )

    parser.add_argument(
        "--sensor-error-rate",
        type=float,
        default=0,
    )

    parser.add_argument(
        "--failure-rate",
        type=float,
        default=0,
    )

    parser.add_argument(
        "--outage-after",
        type=float,
    )

    parser.add_argument(
        "--outage-duration",
        type=float,
        default=30,
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
    )

    parser.add_argument(
        "--show-json",
        action="store_true",
    )

    parser.add_argument(
        "--pretty",
        action="store_true",
    )

    return parser


def main():

    parser = create_parser()

    args = parser.parse_args()

    if args.sensors < 1:
        parser.error(
            "--sensors must be >= 1"
        )

    if not 0 <= args.toggle_rate <= 1:
        parser.error(
            "--toggle-rate must be 0..1"
        )

    if not 0 <= args.failure_rate <= 1:
        parser.error(
            "--failure-rate must be 0..1"
        )

    if not 0 <= args.sensor_error_rate <= 1:
        parser.error(
            "--sensor-error-rate must be 0..1"
        )

    # Validate schedule before starting.
    try:
        parse_schedule(args.schedule)
    except ValueError as e:
        parser.error(str(e))

    simulator = ESP32Simulator(args)

    signal.signal(
        signal.SIGINT,
        simulator.stop,
    )

    signal.signal(
        signal.SIGTERM,
        simulator.stop,
    )

    simulator.run()


if __name__ == "__main__":
    main() #cp paste cpp มา คนเขียนชิน cpp มากกว่า
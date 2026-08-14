'use client';

import { Fragment, useState, type KeyboardEvent } from 'react';
import type { DestinationSuggestion } from '../../shared/types/destination-advice';
import type { WeatherCardResult } from '../../shared/types/weather-and-timing';
import type { FlightOption, HotelOption } from '../../shared/types/flight-hotel-search-booking';
import { useChat, type UiMessage } from '../lib/useChat';
import { AuditPanel } from './AuditPanel';
import { Markdown } from './Markdown';
import styles from './page.module.css';

/**
 * Waypoint chat shell (INC-1 walking skeleton). One screen: a header, the
 * conversation (or a welcome state), and the composer. All streaming logic
 * lives in useChat — this file is just the view.
 */
export default function ChatPage() {
  const { messages, streaming, error, truncated, started, send, reset, auditOpen, auditGroups, toggleAudit, clearAudit } =
    useChat();
  const [draft, setDraft] = useState('');

  const canSend = draft.trim().length > 0 && !streaming;
  const activeDestinationMessage = latestDestinationMessageIndex(messages);
  const activeWeatherMessage = latestWeatherMessageIndex(messages);
  const activeTravelMessage = latestTravelMessageIndex(messages);
  const activeBookingMessage = latestBookingMessageIndex(messages);

  const submit = async () => {
    if (!canSend) return;
    const text = draft;
    // Clear immediately on send; the message is already in the thread. Restore
    // the draft only if the send fails so the traveller can resend.
    setDraft('');
    const ok = await send(text);
    if (!ok) setDraft(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (FR-001-2).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.app}>
      <header className={styles.header} data-testid="app-header">
        <button className={styles.brand} data-testid="brand-home" onClick={reset} aria-label="Waypoint home">
          <CompassIcon />
          Waypoint
        </button>
        <span className={styles.userChip} data-testid="user-chip">
          John Doe · Gold Tier · 7,463 Pts
        </span>
        <span className={styles.spacer} />
        <button className={styles.headerBtn} data-testid="new-chat" onClick={reset}>
          <PlusIcon />
          New chat
        </button>
        <button
          className={styles.headerBtn}
          data-testid="audit-toggle"
          aria-pressed={auditOpen}
          aria-label="Audit trail"
          onClick={toggleAudit}
        >
          <ActivityIcon />
          Audit
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <main className={styles.main}>
        {!started ? (
          <section className={styles.welcome} data-testid="welcome">
            <h1>Where would you like to go?</h1>
            <p>I can suggest destinations, check the weather, and plan flights, hotels and a budget — just ask.</p>
          </section>
        ) : (
          <div className={styles.thread} data-testid="message-list" role="log" aria-live="polite">
            {messages.map((m, i) => {
              const isStreamingBubble = streaming && i === messages.length - 1 && m.role === 'assistant';
              const showDestinations = m.role === 'assistant' && i === activeDestinationMessage && !isStreamingBubble;
              const showWeather = m.role === 'assistant' && i === activeWeatherMessage && !isStreamingBubble;
              const showTravel = m.role === 'assistant' && i === activeTravelMessage && !isStreamingBubble;
              const showBooking = m.role === 'assistant' && i === activeBookingMessage && !isStreamingBubble;
              return (
                <Fragment key={i}>
                  <div
                    data-testid={`message-${m.role}-${i}`}
                    className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}
                  >
                    {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
                    {isStreamingBubble && <span className={styles.caret} data-testid="streaming-caret" aria-hidden />}
                  </div>
                  {showDestinations && (
                    <DestinationList message={m} onExplore={(name) => setDraft(`Tell me more about ${name}`)} />
                  )}
                  {showWeather && <WeatherCard message={m} />}
                  {showTravel && (
                    <TravelOptions message={m} onSelect={(phrase) => setDraft(phrase)} />
                  )}
                  {showBooking && <BookingConfirmationCard message={m} />}
                </Fragment>
              );
            })}
          </div>
        )}
      </main>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} data-testid="error-notice" role="alert">
          {error}
        </div>
      )}
      {truncated && (
        <div className={`${styles.notice} ${styles.truncation}`} data-testid="truncation-notice">
          Your message was long, so it was shortened for the agent.
        </div>
      )}

      <div className={styles.composerWrap}>
        <div className={styles.composer} data-testid="composer">
          <textarea
            className={styles.input}
            data-testid="composer-input"
            placeholder="Ask about destinations, weather, flights or hotels…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message"
          />
          <button className={styles.send} data-testid="send-button" onClick={submit} disabled={!canSend}>
            <SendIcon />
            Send
          </button>
        </div>
      </div>
        </div>

        <AuditPanel open={auditOpen} groups={auditGroups} onClear={clearAudit} />
      </div>
    </div>
  );
}

function latestDestinationMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const advice = messages[index].destinationAdvice;
    if (advice && 'suggestions' in advice) return index;
  }
  return -1;
}

function latestWeatherMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].weatherAdvice) return index;
  }
  return -1;
}

function latestTravelMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].travelOptions) return index;
  }
  return -1;
}

function latestBookingMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].booking) return index;
  }
  return -1;
}

function WeatherCard({ message }: { message: UiMessage }) {
  const weather = message.weatherAdvice;
  if (!weather) return null;
  const baseline = weather.kind === 'month-weather' ? weather.baseline ?? '1991–2020' : '1991–2020';
  return (
    <section className={styles.weatherBubble} aria-label="Weather summary">
      <div className={styles.weatherCard} data-testid="weather-card">
        <h2>
          <SunIcon />
          {weather.place}
        </h2>
        {weather.kind === 'month-weather' ? (
          <WeatherMonth weather={weather} />
        ) : (
          <WeatherWindow weather={weather} />
        )}
        <p className={styles.weatherSource} data-testid="weather-source">
          Source: Open-Meteo (ERA5 {baseline} normals)
        </p>
      </div>
    </section>
  );
}

function WeatherMonth({ weather }: { weather: Extract<WeatherCardResult, { kind: 'month-weather' }> }) {
  return (
    <div className={styles.weatherMonth}>
      <p className={styles.weatherMonthName}>{weather.month}</p>
      <div className={styles.weatherFigures}>
        <span className={styles.weatherFig}>
          <strong>{weather.tempMaxC}°C</strong> day
        </span>
        <span className={styles.weatherFig}>
          <strong>{weather.tempMinC}°C</strong> night
        </span>
        <span className={styles.weatherFig}>
          <strong>{weather.precipMm} mm</strong> rain
        </span>
      </div>
    </div>
  );
}

function WeatherWindow({ weather }: { weather: Extract<WeatherCardResult, { kind: 'weather-window' }> }) {
  return (
    <div className={styles.weatherWindow}>
      <div className={styles.weatherCol}>
        <h3>Best months</h3>
        <ul className={styles.weatherList} data-testid="weather-recommended">
          {weather.recommendedMonths.map((m) => (
            <li key={m.month}>
              <strong>{m.month}</strong> — {m.reason}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.weatherCol}>
        <h3>Months to avoid</h3>
        <ul className={styles.weatherList} data-testid="weather-avoid">
          {weather.avoidMonths.map((m) => (
            <li key={m.month}>
              <strong>{m.month}</strong> — {m.reason}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DestinationList({ message, onExplore }: { message: UiMessage; onExplore: (name: string) => void }) {
  const advice = message.destinationAdvice;
  if (!advice || !('suggestions' in advice)) return null;

  return (
    <section className={styles.destinationBubble} aria-label="Suggested destinations">
      <div className={styles.destinationList} data-testid="destination-list">
        <h2>
          <MapPinIcon />
          Suggested destinations
        </h2>
        <div className={styles.destinations}>
          {advice.suggestions.map((destination, index) => (
            <DestinationItem key={destination.name} destination={destination} index={index} onExplore={onExplore} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DestinationItem({
  destination,
  index,
  onExplore,
}: {
  destination: DestinationSuggestion;
  index: number;
  onExplore: (name: string) => void;
}) {
  return (
    <article className={styles.destinationItem} data-testid={`destination-item-${index}`}>
      <div className={styles.destinationCopy}>
        <h4>{destination.name}</h4>
        <p>{destination.rationale}</p>
        <div className={styles.tags} aria-label="Destination qualities">
          {destination.tags.map((tag) => (
            <span className={styles.tag} data-testid={`tag-${tag}`} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <button className={styles.explore} type="button" onClick={() => onExplore(destination.name)}>
        Explore
        <ArrowRightIcon />
      </button>
    </article>
  );
}

const ORDINALS = ['first', 'second', 'third'];
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function stopsLabel(stops: number): string {
  if (stops === 0) return 'Direct';
  return stops === 1 ? '1 stop' : `${stops} stops`;
}

function TravelOptions({ message, onSelect }: { message: UiMessage; onSelect: (phrase: string) => void }) {
  const options = message.travelOptions;
  const [selFlight, setSelFlight] = useState<number | null>(null);
  const [selHotel, setSelHotel] = useState<number | null>(null);
  if (!options) return null;

  // Build the booking instruction incrementally as the traveller selects each side.
  const compose = (flightIdx: number | null, hotelIdx: number | null): string => {
    const parts: string[] = [];
    if (flightIdx !== null) {
      const flight = options.flights[flightIdx];
      const detail = [flight.airline, flight.flightNumber].filter(Boolean).join(' ');
      parts.push(`the ${ORDINALS[flightIdx] ?? 'first'} flight (${detail})`);
    }
    if (hotelIdx !== null) {
      parts.push(`the ${ORDINALS[hotelIdx] ?? 'first'} hotel (${options.hotels[hotelIdx].name})`);
    }
    return parts.length ? `Book ${parts.join(' and ')}` : '';
  };

  const chooseFlight = (index: number) => {
    setSelFlight(index);
    onSelect(compose(index, selHotel));
  };
  const chooseHotel = (index: number) => {
    setSelHotel(index);
    onSelect(compose(selFlight, index));
  };

  return (
    <section className={styles.travelBubble} aria-label="Flight and hotel options">
      <div className={styles.optionGroup} data-testid="flight-options">
        <h2>
          <PlaneIcon />
          Flights to {options.place}
        </h2>
        <div className={styles.optionCards}>
          {options.flights.map((flight, index) => (
            <FlightOptionCard
              key={`${flight.airline}-${index}`}
              flight={flight}
              index={index}
              selected={selFlight === index}
              onSelect={() => chooseFlight(index)}
            />
          ))}
        </div>
      </div>
      <div className={styles.optionGroup} data-testid="hotel-options">
        <h2>
          <BedIcon />
          Hotels in {options.place}
        </h2>
        <div className={styles.optionCards}>
          {options.hotels.map((hotel, index) => (
            <HotelOptionCard
              key={`${hotel.name}-${index}`}
              hotel={hotel}
              index={index}
              selected={selHotel === index}
              onSelect={() => chooseHotel(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FlightOptionCard({
  flight,
  index,
  selected,
  onSelect,
}: {
  flight: FlightOption;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={`${styles.optionCard} ${selected ? styles.optionCardSelected : ''}`}
      data-testid={`flight-option-${index}`}
      aria-selected={selected}
    >
      <div className={styles.optionMain}>
        <div className={styles.optionTitleRow}>
          <h4>
            {flight.airline}
            {flight.flightNumber ? <span className={styles.optionCode}> · {flight.flightNumber}</span> : null}
          </h4>
          {flight.best && (
            <span className={styles.bestBadge} data-testid="best-badge">
              Best
            </span>
          )}
        </div>
        <p className={styles.optionMeta}>
          {flight.from} → {flight.to} · {formatDuration(flight.durationMin)} · {stopsLabel(flight.stops)}
        </p>
        {(flight.departTime || flight.arriveTime) && (
          <p className={styles.optionSub}>
            Departs {flight.departTime ?? '—'} · Arrives {flight.arriveTime ?? '—'}
          </p>
        )}
      </div>
      <div className={styles.optionAside}>
        <p className={styles.optionPrice}>{gbp.format(flight.pricePerTraveller.amountGBP)}</p>
        <p className={styles.optionPriceNote}>per traveller</p>
        <button
          className={`${styles.selectBtn} ${selected ? styles.selectBtnSelected : ''}`}
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
        >
          {selected ? 'Selected' : 'Select'}
        </button>
      </div>
    </article>
  );
}

function HotelOptionCard({
  hotel,
  index,
  selected,
  onSelect,
}: {
  hotel: HotelOption;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const included = hotel.nightlyRate.source.includesTaxesAndFees;
  return (
    <article
      className={`${styles.optionCard} ${selected ? styles.optionCardSelected : ''}`}
      data-testid={`hotel-option-${index}`}
      aria-selected={selected}
    >
      <div className={styles.optionMain}>
        <div className={styles.optionTitleRow}>
          <h4>{hotel.name}</h4>
          {hotel.best && (
            <span className={styles.bestBadge} data-testid="best-badge">
              Best
            </span>
          )}
        </div>
        <p className={styles.optionMeta} aria-label={`${hotel.rating}-star rating`}>
          <span className={styles.stars} aria-hidden>
            {'★'.repeat(hotel.rating)}
            {'☆'.repeat(Math.max(0, 5 - hotel.rating))}
          </span>{' '}
          · {hotel.rating}-star
        </p>
        {hotel.address && <p className={styles.optionSub}>{hotel.address}</p>}
        <p className={styles.optionPriceNote}>{included ? 'Taxes & fees included' : 'Excludes taxes & fees'}</p>
      </div>
      <div className={styles.optionAside}>
        <p className={styles.optionPrice}>{gbp.format(hotel.nightlyRate.amountGBP)}</p>
        <p className={styles.optionPriceNote}>per night</p>
        <button
          className={`${styles.selectBtn} ${selected ? styles.selectBtnSelected : ''}`}
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
        >
          {selected ? 'Selected' : 'Select'}
        </button>
      </div>
    </article>
  );
}

function BookingConfirmationCard({ message }: { message: UiMessage }) {
  const booking = message.booking;
  if (!booking) return null;
  return (
    <section className={styles.bookingBubble} aria-label="Booking confirmation">
      <div className={styles.bookingCard} data-testid="booking-confirmation">
        <span className={styles.simRibbon}>Demo simulation — no charge, no real booking</span>
        <h2>
          <CheckIcon />
          Booking confirmed
        </h2>
        <p className={styles.bookingRef}>
          Ref <strong>{booking.ref}</strong>
        </p>
        <p className={styles.bookingItinerary}>{booking.itinerary}</p>
        <p className={styles.bookingTotal}>
          Estimated total <strong>{gbp.format(booking.estimatedTotalGBP)}</strong>
        </p>
      </div>
    </section>
  );
}

/* Inline Lucide-style SVG icons (never emoji, per the design system). */
function CompassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
function MapPinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
function PlaneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3.5c-.5-.5-2.5 0-4 1.5L13.5 8.5 5.3 6.7c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L8 12l-1.7 4.2c-.1.3 0 .6.3.8L8 18l3-3 3 3 .9.9c.2.2.5.3.8.3l.5-.3c.3-.2.5-.6.4-1.1Z" />
    </svg>
  );
}
function BedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
